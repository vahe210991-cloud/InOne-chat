// Состояния экрана (этап 0.7.0): ожидание, загрузка, пусто, готово, ошибка.
export const STATE = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', EMPTY: 'empty', ERROR: 'error' });

export const idle = () => ({ status: STATE.IDLE, data: null, message: '' });

// При загрузке прежние данные остаются видимыми, пока приходит новый ответ.
export const loading = (prev = null) => ({ status: STATE.LOADING, data: prev ? prev.data : null, message: '' });

export function ready(data) {
  const empty = data === null || data === undefined || (Array.isArray(data) && data.length === 0);
  return { status: empty ? STATE.EMPTY : STATE.READY, data: empty ? null : data, message: '' };
}

export const failed = (message) => ({ status: STATE.ERROR, data: null, message: String(message) });
