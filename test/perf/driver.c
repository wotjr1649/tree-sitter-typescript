#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#include <time.h>
#endif
#include "tree_sitter/api.h"

const TSLanguage *BENCH_LANGUAGE(void);

static void require(bool ok, const char *operation) {
    if (!ok) {
        fprintf(stderr, "benchmark failed: %s\n", operation);
        exit(1);
    }
}

static uint64_t ticks(void) {
#ifdef _WIN32
    LARGE_INTEGER time;
    QueryPerformanceCounter(&time);
    return (uint64_t)time.QuadPart;
#else
    struct timespec time;
    require(clock_gettime(CLOCK_MONOTONIC, &time) == 0, "read monotonic clock");
    return (uint64_t)time.tv_sec * 1000000000 + time.tv_nsec;
#endif
}

static uint64_t peak_rss(void) {
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS memory = {.cb = sizeof(memory)};
    require(GetProcessMemoryInfo(GetCurrentProcess(), &memory, sizeof(memory)), "read peak working set");
    return memory.PeakWorkingSetSize;
#else
    struct rusage usage;
    require(getrusage(RUSAGE_SELF, &usage) == 0, "read peak RSS");
#ifdef __APPLE__
    return usage.ru_maxrss;
#else
    return (uint64_t)usage.ru_maxrss * 1024;
#endif
#endif
}

static uint32_t read_u32(FILE *input) {
    unsigned char bytes[4];
    require(fread(bytes, 1, sizeof(bytes), input) == sizeof(bytes), "read integer");
    return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
           (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static TSPoint point(const char *source, uint32_t length, TSPoint start) {
    for (uint32_t i = 0; i < length; i++) {
        if (source[i] == '\n') {
            start.row++;
            start.column = 0;
        } else {
            start.column++;
        }
    }
    return start;
}

static TSTree *parse(TSParser *parser, const TSTree *old, const char *source,
                     uint32_t length, bool timed, uint32_t kind) {
    uint64_t start = ticks();
    TSTree *tree = ts_parser_parse_string(parser, old, source, length);
    uint64_t elapsed = ticks() - start;
    require(tree != NULL, "parse");
    if (timed) printf("%u,%" PRIu64 "\n", kind, elapsed);
    return tree;
}

static void parse_pack(TSParser *parser, const char *path, bool timed) {
    FILE *input = fopen(path, "rb");
    require(input != NULL, "open pack");
    uint32_t count = read_u32(input);
    for (uint32_t file = 0; file < count; file++) {
        uint32_t length = read_u32(input);
        uint32_t edits = read_u32(input);
        char *source = malloc(length ? length : 1);
        require(source && fread(source, 1, length, input) == length, "read source");
        TSTree *tree = parse(parser, NULL, source, length, timed, 0);

        for (uint32_t i = 0; i < edits; i++) {
            uint32_t kind = read_u32(input);
            uint32_t start = read_u32(input);
            uint32_t end = read_u32(input);
            uint32_t added = read_u32(input);
            require(kind > 0 && kind < 8 && start <= end && end <= length &&
                    added <= UINT32_MAX - (length - (end - start)), "edit bounds");
            uint32_t new_length = length - (end - start) + added;
            char *updated = malloc(new_length ? new_length : 1);
            require(updated != NULL, "allocate updated source");
            memcpy(updated, source, start);
            require(fread(updated + start, 1, added, input) == added, "read insertion");
            memcpy(updated + start + added, source + end, length - end);
            TSPoint at = point(source, start, (TSPoint){0});
            TSInputEdit edit = {
                start, end, start + added, at,
                point(source + start, end - start, at), point(updated + start, added, at),
            };

            TSTree *old = ts_tree_copy(tree);
            require(old != NULL, "copy tree");
            ts_tree_edit(old, &edit);
            TSTree *result = parse(parser, old, updated, new_length, timed, kind);
            ts_tree_delete(result);
            ts_tree_delete(old);
            free(updated);
        }
        ts_tree_delete(tree);
        free(source);
    }
    require(count > 0 && fgetc(input) == EOF && !ferror(input), "pack terminator");
    fclose(input);
}

int main(int argc, char **argv) {
    require(argc == 3, "expected PACK WARM_PACK");
#ifdef _WIN32
    const char *cpu = getenv("PERF_CPU");
    if (cpu) {
        char *end;
        unsigned long index = strtoul(cpu, &end, 10);
        require(end != cpu && !*end && index < sizeof(DWORD_PTR) * 8 &&
                SetProcessAffinityMask(GetCurrentProcess(), (DWORD_PTR)1 << index), "set PERF_CPU affinity");
    }
    LARGE_INTEGER frequency;
    require(QueryPerformanceFrequency(&frequency), "read timer frequency");
    printf("frequency,%" PRId64 "\n", (int64_t)frequency.QuadPart);
#else
    puts("frequency,1000000000");
#endif
    TSParser *parser = ts_parser_new();
    require(parser && ts_parser_set_language(parser, BENCH_LANGUAGE()), "set language (check parser ABI)");
    parse_pack(parser, argv[2], false);
    parse_pack(parser, argv[1], true);
    printf("peak_rss,%" PRIu64 "\n", peak_rss());
    ts_parser_delete(parser);
    return 0;
}
