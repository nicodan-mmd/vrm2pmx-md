// GLB binary header constants (little-endian)
const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_JSON_CHUNK_TYPE: u32 = 0x4E4F534A; // "JSON"

// --- Safe internal helpers ---

fn read_u32_le(buf: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
}

/// Locate the JSON chunk inside a GLB byte slice.
/// Returns `Ok((offset_of_content, byte_length))` or an error code:
///   -1  input shorter than the minimum 20-byte header
///   -2  invalid GLB magic
///   -3  unsupported GLB version (expected 2)
///   -4  first chunk is not a JSON chunk
///   -5  JSON chunk extends beyond the provided buffer
fn glb_locate_json_chunk(buf: &[u8]) -> Result<(usize, usize), i32> {
    if buf.len() < 20 {
        return Err(-1);
    }
    if read_u32_le(buf, 0) != GLB_MAGIC {
        return Err(-2);
    }
    if read_u32_le(buf, 4) != 2 {
        return Err(-3);
    }
    let json_len = read_u32_le(buf, 12) as usize;
    if read_u32_le(buf, 16) != GLB_JSON_CHUNK_TYPE {
        return Err(-4);
    }
    let json_end = 20usize.saturating_add(json_len);
    if json_end > buf.len() {
        return Err(-5);
    }
    Ok((20, json_len))
}

// --- Public Wasm exports ---

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

/// Free memory previously allocated by `vrm2pmx_alloc` or `vrm2pmx_get_json_chunk`.
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_free(ptr: *mut u8, size: usize) {
    let _ = Vec::from_raw_parts(ptr, 0, size);
}

/// Parse the JSON chunk from a GLB byte buffer and return its byte length.
/// Returns the JSON chunk length (>= 0) on success, or a negative error code.
#[no_mangle]
pub unsafe extern "C" fn vrm2pmx_parse_glb_json_len(ptr: *const u8, len: usize) -> i32 {
    let buf = core::slice::from_raw_parts(ptr, len);
    match glb_locate_json_chunk(buf) {
        Ok((_, json_len)) => json_len as i32,
        Err(code) => code,
    }
}

/// Extract the JSON chunk bytes from a GLB byte buffer.
///
/// On success:
///   - Allocates a new buffer containing the raw JSON bytes.
///   - Writes the byte count as an i32 (little-endian) to the 4 bytes at `out_len_ptr`.
///   - Returns a pointer to the allocated buffer.
///   - The caller must free it with `vrm2pmx_free(returned_ptr, out_len)`.
///
/// On error:
///   - Writes a negative i32 error code to `out_len_ptr`.
///   - Returns null (0).
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