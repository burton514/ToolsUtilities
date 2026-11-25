// Kéo mượt: gộp các sự kiện pointermove thành tối đa MỘT cập nhật mỗi khung hình màn hình (requestAnimationFrame).
// Chuột/bút có thể bắn 120–1000 sự kiện/giây; mỗi sự kiện mà cập nhật store là cả timeline + preview + inspector
// vẽ lại → giật. Dùng chung cho mọi thao tác kéo trong editor (clip, vạch phát, lớp trên preview, pan, thanh phân cách).

/** Gói `fn` để chỉ chạy với tham số mới nhất, tối đa một lần mỗi khung hình. `flush()` chạy ngay phần còn chờ. */
export function frameThrottle<A extends unknown[]>(fn: (...args: A) => void) {
  let pending: A | null = null;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = undefined;
    if (pending) {
      const a = pending;
      pending = null;
      fn(...a);
    }
  };
  const call = (...args: A) => {
    pending = args;
    if (!raf && !timer) {
      raf = requestAnimationFrame(run);
      // dự phòng: trình duyệt tạm dừng requestAnimationFrame khi cửa sổ chạy nền
      timer = setTimeout(run, 40);
    }
  };
  call.flush = run;
  return call;
}

/**
 * Bắt đầu một thao tác kéo: `onMove` được gộp theo khung hình, `onEnd` chạy sau lần cập nhật cuối.
 * Trả về hàm hủy. Dùng thay cho cặp addEventListener/removeEventListener lặp lại ở mọi nơi.
 */
export function startDrag(onMove: (ev: PointerEvent) => void, onEnd?: (ev: PointerEvent) => void) {
  const move = frameThrottle(onMove);
  const up = (ev: PointerEvent) => {
    move.flush();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    document.body.classList.remove("ed-dragging");
    onEnd?.(ev);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  document.body.classList.add("ed-dragging");
  return () => up(new PointerEvent("pointerup"));
}
