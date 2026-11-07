#include <lean/lean.h>
#include <emscripten/emscripten.h>

extern void lean_initialize_runtime_module(void);
extern lean_object *initialize_Compiler(uint8_t builtin);
extern lean_object *playground_compile(lean_object *source, lean_object *args);
static lean_object *result;
static int initialized;

EMSCRIPTEN_KEEPALIVE int compile_verse(const char *source, const char *args) {
    if (!initialized) {
        lean_initialize_runtime_module();
        lean_object *init = initialize_Compiler(1);
        if (lean_io_result_is_error(init)) {
            lean_io_result_show_error(init);
            lean_dec(init);
            return 2;
        }
        lean_dec(init);
        lean_io_mark_end_initialization();
        initialized = 1;
    }
    if (result) lean_dec(result);
    result = playground_compile(lean_mk_string(source), lean_mk_string(args));
    return lean_sarray_cptr(result)[0];
}
EMSCRIPTEN_KEEPALIVE const uint8_t *compiled_data(void) {
    return result ? lean_sarray_cptr(result) + 1 : NULL;
}
EMSCRIPTEN_KEEPALIVE size_t compiled_size(void) {
    return result ? lean_sarray_size(result) - 1 : 0;
}
