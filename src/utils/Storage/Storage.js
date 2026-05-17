const storage = import('storage').catch(() => import('./FakeStorage'));

const defaultSetting = {
    mode: 'page',
    isLarger: false,
    isDebug: false,
};

function getNow() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export default class Storage {
    async _get(key) {
        try {
            const value = await (await storage).default.getStorage(key);
            return JSON.parse(value);
        } catch (e) {
            return null;
        }
    }

    async _set(key, value) {
        try {
            await (await storage).default.setStorage(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }

    async addItem(path, progress, target = 'history') {
        let history = await this._get(target);
        if (!history) {
            history = [];
        }

        if (target === 'history') {
            history = history.filter(item => item.path !== path);
        }
        history.push({ path, progress, time: getNow() });

        await this._set(target, history);
    }

    async getItem(path, target = 'history') {
        let history = await this._get(target);
        if (!history) {
            return null;
        }

        const item = history.find(item => item.path === path);
        if (!item) {
            return null;
        }

        return item.progress;
    }

    async clearItems(target = 'history') {
        await this._set(target, []);
    }

    async getAllItems(target = 'history') {
        let history = await this._get(target);
        if (!history) {
            return [];
        }

        return history;
    }

    async set(key, value) {
        if (key in defaultSetting) {
            await this._set(key, value);
        }
    }

    async get(key) {
        if (key in defaultSetting) {
            const value = await this._get(key);
            if (value !== null) {
                return value;
            } else {
                await this._set(key, defaultSetting[key]);
                return defaultSetting[key];
            }
        }
    }
}