//! Bảng thao tác chung trên composition — MỘT nơi định nghĩa cách sửa bản dựng, dùng cho tool `compose_edit`,
//! API `POST /v1/composition/edit`, chuỗi tự động và AI (MCP). Thao tác làm trên JSON rồi kiểm tra lại bằng
//! model của engine, nên bản dựng sau khi sửa luôn hợp lệ.
//!
//! Chọn lớp (`target`): id của lớp · `"*"` mọi lớp · `"type:text"` mọi lớp chữ (video, image, text, shape, audio, adjust).
//!
//! | op | Trường | Làm gì |
//! |---|---|---|
//! | `add_layer` | `layer`, `index`? | Thêm lớp (mặc định trên cùng; `index` 0 = dưới cùng) |
//! | `update_layer` | `target`, `patch` | Gộp `patch` vào lớp (JSON merge: object gộp đệ quy, `null` xóa trường) |
//! | `remove_layer` | `target` | Xóa lớp |
//! | `move_layer` | `target`, `index` | Đổi thứ tự (`-1` = trên cùng) |
//! | `set` | `path`, `value` | Đặt giá trị theo đường dẫn: `canvas.background`, `layers.<id>.style.size`, `layers.<id>.effects.0.amount` |
//! | `add_effect` | `target`, `effect` | Thêm hiệu ứng (có sẵn hoặc gói thư viện) |
//! | `add_animation` | `target`, `animation` | Thêm chuyển động |
//! | `add_marker` | `marker` | Thêm mốc thời gian |
//! | `merge` | `patch` | Gộp vào cả bản dựng |

use anyhow::{anyhow, Result};
use serde_json::{Map, Value};

fn merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                if v.is_null() {
                    b.remove(k);
                } else {
                    merge(b.entry(k.clone()).or_insert(Value::Null), v);
                }
            }
        }
        (b, p) => *b = p.clone(),
    }
}

fn matches(layer: &Value, target: &str) -> bool {
    match target {
        "*" => true,
        t if t.starts_with("type:") => layer["type"] == t[5..],
        id => layer["id"] == id,
    }
}

fn layers_mut(comp: &mut Value) -> Result<&mut Vec<Value>> {
    if comp.get("layers").is_none() {
        comp["layers"] = Value::Array(vec![]);
    }
    comp["layers"].as_array_mut().ok_or_else(|| anyhow!("'layers' phải là mảng"))
}

fn field<'a>(op: &'a Value, k: &str) -> Result<&'a Value> {
    op.get(k).filter(|v| !v.is_null()).ok_or_else(|| anyhow!("thao tác '{}' thiếu trường '{k}'", op["op"].as_str().unwrap_or("?")))
}

fn target<'a>(op: &'a Value) -> Result<&'a str> {
    field(op, "target")?.as_str().ok_or_else(|| anyhow!("'target' phải là chuỗi"))
}

fn push_to(comp: &mut Value, t: &str, key: &str, item: &Value) -> Result<usize> {
    let mut n = 0;
    for l in layers_mut(comp)?.iter_mut().filter(|l| matches(l, t)) {
        if !l.get(key).is_some_and(Value::is_array) {
            l[key] = Value::Array(vec![]);
        }
        l[key].as_array_mut().unwrap().push(item.clone());
        n += 1;
    }
    Ok(n)
}

/// Đặt giá trị theo đường dẫn chấm; đoạn sau `layers.` là id lớp (hoặc chỉ số).
fn set_path(comp: &mut Value, path: &str, val: Value) -> Result<()> {
    let parts: Vec<&str> = path.split('.').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err(anyhow!("đường dẫn trống"));
    }
    let mut cur = comp;
    let mut i = 0;
    while i < parts.len() {
        let key = parts[i];
        let last = i + 1 == parts.len();
        if key == "layers" && i + 1 < parts.len() {
            let id = parts[i + 1];
            let arr = cur["layers"].as_array_mut().ok_or_else(|| anyhow!("không có 'layers'"))?;
            let idx = arr.iter().position(|l| l["id"] == id).or_else(|| id.parse().ok()).ok_or_else(|| anyhow!("không có lớp '{id}'"))?;
            cur = arr.get_mut(idx).ok_or_else(|| anyhow!("không có lớp '{id}'"))?;
            i += 2;
            if i == parts.len() {
                *cur = val;
                return Ok(());
            }
            continue;
        }
        let next: &mut Value = match cur {
            Value::Array(a) => a.get_mut(key.parse::<usize>().map_err(|_| anyhow!("'{key}' phải là chỉ số"))?).ok_or_else(|| anyhow!("chỉ số '{key}' ngoài mảng"))?,
            Value::Object(o) => {
                if last {
                    o.insert(key.to_string(), val);
                    return Ok(());
                }
                o.entry(key.to_string()).or_insert(Value::Object(Map::new()))
            }
            _ => return Err(anyhow!("không đi tiếp được tại '{key}'")),
        };
        if last {
            *next = val;
            return Ok(());
        }
        cur = next;
        i += 1;
    }
    Ok(())
}

/// Áp danh sách thao tác. Trả bản dựng mới + số lớp bị ảnh hưởng theo từng thao tác (để báo cho người dùng).
pub fn apply(mut comp: Value, ops: &[Value]) -> Result<(Value, Vec<usize>)> {
    let mut counts = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        let name = op["op"].as_str().ok_or_else(|| anyhow!("thao tác #{} thiếu 'op'", i + 1))?;
        let n = match name {
            "add_layer" => {
                let layer = field(op, "layer")?.clone();
                let arr = layers_mut(&mut comp)?;
                let idx = op["index"].as_i64().map(|x| if x < 0 { arr.len() } else { (x as usize).min(arr.len()) }).unwrap_or(arr.len());
                arr.insert(idx, layer);
                1
            }
            "update_layer" => {
                let (t, patch) = (target(op)?.to_string(), field(op, "patch")?.clone());
                let mut n = 0;
                for l in layers_mut(&mut comp)?.iter_mut().filter(|l| matches(l, &t)) {
                    merge(l, &patch);
                    n += 1;
                }
                n
            }
            "remove_layer" => {
                let t = target(op)?.to_string();
                let arr = layers_mut(&mut comp)?;
                let before = arr.len();
                arr.retain(|l| !matches(l, &t));
                before - arr.len()
            }
            "move_layer" => {
                let t = target(op)?.to_string();
                let arr = layers_mut(&mut comp)?;
                let Some(pos) = arr.iter().position(|l| matches(l, &t)) else { return Err(anyhow!("không có lớp '{t}'")) };
                let l = arr.remove(pos);
                let idx = op["index"].as_i64().unwrap_or(-1);
                let idx = if idx < 0 { arr.len() } else { (idx as usize).min(arr.len()) };
                arr.insert(idx, l);
                1
            }
            "set" => {
                let path = field(op, "path")?.as_str().ok_or_else(|| anyhow!("'path' phải là chuỗi"))?.to_string();
                set_path(&mut comp, &path, op.get("value").cloned().unwrap_or(Value::Null))?;
                1
            }
            "add_effect" => push_to(&mut comp, target(op)?, "effects", field(op, "effect")?)?,
            "add_animation" => push_to(&mut comp, target(op)?, "animations", field(op, "animation")?)?,
            "add_marker" => {
                let m = field(op, "marker")?.clone();
                if !comp.get("markers").is_some_and(Value::is_array) {
                    comp["markers"] = Value::Array(vec![]);
                }
                comp["markers"].as_array_mut().unwrap().push(m);
                1
            }
            "merge" => {
                merge(&mut comp, field(op, "patch")?);
                1
            }
            other => return Err(anyhow!("thao tác không hỗ trợ: '{other}'")),
        };
        counts.push(n);
    }
    // kiểm tra lại bằng model của engine: bản dựng sau khi sửa phải hợp lệ
    serde_json::from_value::<crate::model::Composition>(comp.clone()).map_err(|e| anyhow!("Bản dựng sau khi sửa không hợp lệ: {e}"))?;
    Ok((comp, counts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ops_apply() {
        let c = json!({"canvas": {"width": 1920, "height": 1080}, "layers": [
            {"id": "v", "type": "shape", "start": 0, "duration": 5},
            {"id": "t", "type": "text", "text": "a", "style": {"size": 60}, "start": 0, "duration": 5}
        ]});
        let ops = vec![
            json!({"op": "set", "path": "layers.t.style.size", "value": 120}),
            json!({"op": "update_layer", "target": "type:text", "patch": {"y": 0.8}}),
            json!({"op": "add_effect", "target": "*", "effect": {"type": "film_grain"}}),
            json!({"op": "add_layer", "layer": {"id": "n", "type": "shape", "start": 1, "duration": 2}, "index": 0}),
            json!({"op": "move_layer", "target": "n", "index": -1}),
            json!({"op": "set", "path": "canvas.background", "value": "#112233"}),
            json!({"op": "remove_layer", "target": "v"}),
        ];
        let (out, counts) = apply(c, &ops).unwrap();
        assert_eq!(counts, vec![1, 1, 2, 1, 1, 1, 1]);
        assert_eq!(out["layers"][0]["style"]["size"], 120);
        assert_eq!(out["layers"][0]["y"], 0.8);
        assert_eq!(out["layers"][1]["id"], "n");
        assert_eq!(out["canvas"]["background"], "#112233");
        assert!(apply(out, &[json!({"op": "nope"})]).is_err());
    }
}
