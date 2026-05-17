import fs from 'fs';

const ROOT = `${$dataDir}/__kv__`;

function encode(str) {
    return encodeURIComponent(String(str));
}

function decode(str) {
    return decodeURIComponent(str);
}

function getKeyPath(key) {
    return `${ROOT}/${encode(key)}`;
}

async function ensureRoot() {
    const exists = await fs.exists(ROOT);

    if (!exists) {
        const ok = await fs.mkdir(ROOT);

        if (!ok) {
            throw new Error('failed to create storage root');
        }
    }
}

const storage = {
    async getStorage(key) {
        await ensureRoot();

        const keyPath = getKeyPath(key);

        const exists = await fs.exists(keyPath);

        if (!exists) {
            throw new Error(`key not found: ${key}`);
        }

        const dirents = await fs.readdir(keyPath, {
            withFileTypes: true
        });

        for (let i = 0; i < dirents.length; i++) {
            const dirent = dirents[i];

            if (!dirent.isDirectory()) {
                continue;
            }

            return decode(dirent.name);
        }

        throw new Error(`invalid storage entry: ${key}`);
    },

    async setStorage(key, value) {
        await ensureRoot();

        const keyPath = getKeyPath(key);

        // 删除旧值
        const exists = await fs.exists(keyPath);

        if (exists) {
            await fs.rm(keyPath);
        }

        const finalPath =
            `${keyPath}/${encode(String(value))}`;

        const ok = await fs.mkdir(finalPath);

        if (!ok) {
            throw new Error('setStorage failed');
        }

        return 0;
    },

    async getStorageKeys() {
        await ensureRoot();

        const dirents = await fs.readdir(ROOT, {
            withFileTypes: true
        });

        const keys = [];

        for (let i = 0; i < dirents.length; i++) {
            const dirent = dirents[i];

            if (!dirent.isDirectory()) {
                continue;
            }

            keys.push(decode(dirent.name));
        }

        return keys;
    },

    async removeStorage(key) {
        await ensureRoot();

        const keyPath = getKeyPath(key);

        const exists = await fs.exists(keyPath);

        if (!exists) {
            return 0;
        }

        const ok = await fs.rm(keyPath);

        if (!ok) {
            throw new Error('removeStorage failed');
        }

        return 0;
    },

    async clearStorage() {
        const exists = await fs.exists(ROOT);

        if (exists) {
            await fs.rm(ROOT);
        }

        const ok = await fs.mkdir(ROOT);

        if (!ok) {
            throw new Error('clearStorage failed');
        }

        return 0;
    }
};

export default storage;