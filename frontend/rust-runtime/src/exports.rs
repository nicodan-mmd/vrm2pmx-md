use super::{glb_locate_bin_chunk, glb_locate_json_chunk};

/// Return the runtime version.
#[no_mangle]
pub extern "C" fn vrm2pmx_version() -> u32 {
    1
}

/// Allocate `size` bytes on the Wasm heap.
/// The caller must call `vrm2pmx_free(ptr, size)` when finished.
#[no_mangle]
pub extern "C" fn vrm2pmx_alloc(size: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(size);
    let ptr = v.as_mut_ptr();
    core::mem::forget(v);
    ptr
}

/// Free memory previously allocated by `vrm2pmx_alloc` or one of the chunk getters.
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_free(ptr: *mut u8, size: usize) {
    let _ = Vec::from_raw_parts(ptr, 0, size);
}

/// Parse the JSON chunk from a GLB byte buffer and return its byte length.
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_parse_glb_json_len(ptr: *const u8, len: usize) -> i32 {
    let buf = core::slice::from_raw_parts(ptr, len);
    match glb_locate_json_chunk(buf) {
        Ok((_, json_len)) => json_len as i32,
        Err(code) => code,
    }
}

/// Extract the JSON chunk bytes from a GLB byte buffer.
/// On success: allocates output buffer, writes byte count to out_len_ptr, returns pointer.
/// On error: writes negative code to out_len_ptr, returns null.
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_get_json_chunk(
    ptr: *const u8,
    len: usize,
    out_len_ptr: *mut i32,
) -> *mut u8 {
    let buf = core::slice::from_raw_parts(ptr, len);
    match glb_locate_json_chunk(buf) {
        Ok((offset, json_len)) => {
            let mut out: Vec<u8> = buf[offset..offset + json_len].to_vec();
            *out_len_ptr = json_len as i32;
            let out_ptr = out.as_mut_ptr();
            core::mem::forget(out);
            out_ptr
        }
        Err(code) => {
            *out_len_ptr = code;
            core::ptr::null_mut()
        }
    }
}

/// Extract the BIN chunk bytes from a GLB byte buffer.
/// On success: allocates output buffer, writes byte count to out_len_ptr, returns pointer.
/// On error: writes negative code to out_len_ptr, returns null.
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_get_bin_chunk(
    ptr: *const u8,
    len: usize,
    out_len_ptr: *mut i32,
) -> *mut u8 {
    let buf = core::slice::from_raw_parts(ptr, len);
    match glb_locate_bin_chunk(buf) {
        Ok((offset, bin_len)) => {
            let mut out: Vec<u8> = buf[offset..offset + bin_len].to_vec();
            *out_len_ptr = bin_len as i32;
            let out_ptr = out.as_mut_ptr();
            core::mem::forget(out);
            out_ptr
        }
        Err(code) => {
            *out_len_ptr = code;
            core::ptr::null_mut()
        }
    }
}