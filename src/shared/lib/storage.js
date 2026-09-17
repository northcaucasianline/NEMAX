export const storage = {
  get: (key, fallback = []) => {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Не удалось сохранить ${key} в localStorage`, error);
      return false;
    }
  },
};
