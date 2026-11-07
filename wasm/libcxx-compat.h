#pragma once
#include <bit>
// Debian/Ubuntu's Emscripten 3.1.6 bundles a libc++ without C++20 bit_cast.
// Clang's builtin implements precisely the operation used by Lean's runtime.
#ifndef __cpp_lib_bit_cast
namespace std {
template<class To, class From>
constexpr To bit_cast(const From &value) noexcept {
    static_assert(sizeof(To) == sizeof(From));
    return __builtin_bit_cast(To, value);
}
}
#endif
