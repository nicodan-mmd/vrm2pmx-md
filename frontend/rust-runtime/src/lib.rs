// GLB binary header constants (little-endian)
const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_JSON_CHUNK_TYPE: u32 = 0x4E4F534A; // "JSON"
const GLB_BIN_CHUNK_TYPE: u32 = 0x004E_4942; // "BIN\0"

// All #[no_mangle] Wasm exports live in exports.rs.
mod exports;

// --- Safe internal helpers ---

fn read_u32_le(buf: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
}

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

pub(crate) fn glb_locate_bin_chunk(buf: &[u8]) -> Result<(usize, usize), i32> {
    let (json_offset, json_len) = glb_locate_json_chunk(buf)?;
    let bin_header_start = json_offset.saturating_add(json_len);
    if bin_header_start + 8 > buf.len() {
        return Err(-6);
    }
    let bin_len = read_u32_le(buf, bin_header_start) as usize;
    if read_u32_le(buf, bin_header_start + 4) != GLB_BIN_CHUNK_TYPE {
        return Err(-6);
    }
    let bin_data_start = bin_header_start + 8;
    let bin_end = bin_data_start.saturating_add(bin_len);
    if bin_end > buf.len() {
        return Err(-7);
    }
    Ok((bin_data_start, bin_len))
}