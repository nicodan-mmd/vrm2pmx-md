// GLB binary header constants (little-endian)
const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_JSON_CHUNK_TYPE: u32 = 0x4E4F534A; // "JSON"

/// Return the runtime stub version used by the JS bridge for validation.
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

/// Free memory previously allocated by `vrm2pmx_alloc`.
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_free(ptr: *mut u8, size: usize) {
    let _ = Vec::from_raw_parts(ptr, 0, size);
}

/// Parse the JSON chunk from a GLB byte buffer and return its byte length.
///
/// Returns the JSON chunk length (>= 0) on success, or a negative error code:
///   -1  input shorter than the minimum 20-byte GLB header + chunk header
///   -2  invalid GLB magic (not a VRM/GLB file)
///   -3  unsupported GLB version (expected 2)
///   -4  JSON chunk type byte sequence not found at expected offset
///   -5  JSON chunk extends beyond the end of the provided buffer
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_parse_glb_json_len(ptr: *const u8, len: usize) -> i32 {
    if len < 20 {
        return -1;
    }

    let buf = core::slice::from_raw_parts(ptr, len);

    let magic = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
    if magic != GLB_MAGIC {
        return -2;
    }

    let version = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
    if version != 2 {
        return -3;
    }

    // bytes 12-15: JSON chunk byte length
    let json_chunk_len = u32::from_le_bytes([buf[12], buf[13], buf[14], buf[15]]);

    // bytes 16-19: JSON chunk type
    let json_chunk_type = u32::from_le_bytes([buf[16], buf[17], buf[18], buf[19]]);
    if json_chunk_type != GLB_JSON_CHUNK_TYPE {
        return -4;
    }

    // verify the JSON chunk fits within the buffer
    let json_end = 20usize.saturating_add(json_chunk_len as usize);
    if json_end > len {
        return -5;
    }

    json_chunk_len as i32
}