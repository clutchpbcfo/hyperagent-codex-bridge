export function createMemoryIdempotencyManager() {
  const records = new Map();
  return {
    async claim(key, fingerprint, requestId) {
      const record = records.get(key);
      if (record) return { claimed: false, record: structuredClone(record) };
      const created = { fingerprint, requestId, state: 'in_progress' };
      records.set(key, created);
      return { claimed: true, record: structuredClone(created) };
    },
    async update(key, requestId, patch) {
      const record = records.get(key);
      if (!record || record.requestId !== requestId) throw new Error('Missing in-memory idempotency record.');
      const updated = { ...record, ...structuredClone(patch) };
      records.set(key, updated);
      return structuredClone(updated);
    },
    async delete(key, requestId) {
      if (records.get(key)?.requestId === requestId) records.delete(key);
    },
    async reconcile() { return records.size; },
    records
  };
}
