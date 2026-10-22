// Small fetch wrapper for the REST API (same origin; cookies sent automatically).
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'You seem to be offline. Check your connection.', 'network');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) window.dispatchEvent(new Event('bc:unauthorized'));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

/** Upload a file: ask for a signed URL, PUT the bytes, return the key. */
export async function uploadFile(file: File, purpose: 'attachment' | 'avatar' | 'group-avatar', onProgress?: (p: number) => void) {
  const mime = file.type || 'application/octet-stream';
  const { key, upload } = await api.post<{ key: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }>('/uploads', {
    name: file.name,
    size: file.size,
    mime,
    purpose,
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    Object.entries(upload.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'Upload failed')));
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — check your connection'));
    xhr.send(file);
  });
  return { key, name: file.name, size: file.size, mime };
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
