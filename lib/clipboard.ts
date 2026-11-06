// navigator.clipboard only exists on https, so plain http falls back to a hidden text box.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.append(box);
    box.select();
    box.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    box.remove();
    return copied;
  }
}
