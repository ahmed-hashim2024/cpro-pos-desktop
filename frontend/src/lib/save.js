// Save a file the user downloads. Inside the desktop window this opens the
// native "Save as" dialog (WebViews don't reliably handle downloads);
// in a browser it falls back to a normal download.
export async function saveBlob(blob, filename) {
  const native = window.go?.native?.Native;
  if (native?.SaveFile) {
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return native.SaveFile(filename, b64);
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
