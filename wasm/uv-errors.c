/* Lean's standard stdout/stderr streams use libuv's error messages. We need
   only this public error-map function, not an OS event loop or host library. */
#include <uv.h>
const char *uv_strerror(int error) {
    switch (error) {
#define UV_MESSAGE(code, message) case UV_##code: return message;
        UV_ERRNO_MAP(UV_MESSAGE)
#undef UV_MESSAGE
        default: return "unknown libuv error";
    }
}
