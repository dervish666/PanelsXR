// localStorage that won't crash the app in private mode or on quota errors.
// Persistence here is best-effort (resume point, view preferences), so a failure
// is warned-not-thrown — but never silently swallowed.

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (err) {
    console.warn(`[Panel] localStorage read failed for ${key}`, err)
    return null
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (err) {
    console.warn(`[Panel] localStorage write failed for ${key}`, err)
  }
}

export function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch (err) {
    console.warn(`[Panel] localStorage remove failed for ${key}`, err)
  }
}
