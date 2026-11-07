#include "vx_runtime.h"
#include <stdio.h>
#include <emscripten/emscripten.h>

/* The CLI's pthread stack allocator is unnecessary in a service worker.
   The module has a fixed 16 MiB stack and conservative recursion bounds. */
EMSCRIPTEN_KEEPALIVE int run_bytecode(const uint8_t *data, size_t size, unsigned fuel) {
    vx_program program;
    int loaded = vx_load(data, size, &program);
    if (loaded != VX_LOAD_OK) {
        fprintf(stderr, "cannot load bytecode: %s\n", vx_load_reason(loaded));
        return 4;
    }
    vx_opts opts;
    vx_outcome out;
    vx_default_opts(&opts);
    opts.fuel = fuel;
    opts.max_steps = fuel;
    opts.max_heap = (size_t)1 << 22;
    opts.max_slots = (size_t)1 << 18;
    opts.max_journal = (size_t)1 << 18;
    opts.max_out = (size_t)1 << 17;
    opts.max_vstack = (size_t)1 << 18;
    opts.max_depth = 1000;
    opts.stack_budget = (size_t)8 << 20;
    vx_run(&program, &opts, &out);
    int code;
    if (out.kind == VX_R_LIMIT) {
        fprintf(stderr, "limit: %s\n", vx_limit_name(out.code));
        code = 3;
    } else {
        if (out.outlen) fwrite(out.out, 1, out.outlen, stdout);
        fflush(stdout);
        if (out.kind == VX_R_OK || out.kind == VX_R_RET) code = 0;
        else if (out.kind == VX_R_FAIL) { fputs("failure\n", stderr); code = 1; }
        else if (out.kind == VX_R_BRK) { fputs("error: control\n", stderr); code = 2; }
        else { fprintf(stderr, "error: %s\n", vx_err_name(out.code)); code = 2; }
    }
    vx_outcome_free(&out);
    vx_free_program(&program);
    return code;
}
