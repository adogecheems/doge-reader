const MODULE_NAMES = ['fs', 'file', 'fileSystem', 'io'];

let fileSystemPromise = null;

function joinPath(parent, name) {
    return parent.endsWith('/') ? parent + name : parent + '/' + name;
}

function unwrapModule(module) {
    if (!module) return null;

    const defaultApi = module.default;
    if (defaultApi && typeof defaultApi.readFile === 'function'
        && typeof defaultApi.readdir === 'function') {
        return defaultApi;
    }

    return module;
}

async function loadFileSystem() {
    if (!fileSystemPromise) {
        fileSystemPromise = (async () => {
            const errors = [];

            for (const name of MODULE_NAMES) {
                try {
                    // Resolve platform modules at runtime so a missing optional
                    // module does not prevent the reader pages from loading.
                    const loaded = await import(name);
                    const api = unwrapModule(loaded);

                    if (api && typeof api.readFile === 'function'
                        && typeof api.readdir === 'function') {
                        return { api, name };
                    }

                    errors.push(name + ': missing readFile/readdir');
                } catch (error) {
                    errors.push(name + ': ' + String(error));
                }
            }

            throw new Error('No supported file-system module found. ' + errors.join('; '));
        })();
    }

    try {
        return await fileSystemPromise;
    } catch (error) {
        // Allow a later retry if the runtime becomes available after startup.
        fileSystemPromise = null;
        throw error;
    }
}

function getEntryType(entry) {
    if (entry && typeof entry.isDirectory === 'function') {
        return entry.isDirectory();
    }

    if (entry && typeof entry.isDirectory === 'boolean') {
        return entry.isDirectory;
    }

    if (entry && typeof entry.type === 'string') {
        return entry.type === 'directory' || entry.type === 'dir';
    }

    return null;
}

async function readDirectory(path) {
    const { api } = await loadFileSystem();
    let entries;

    try {
        entries = await api.readdir(path, { withFileTypes: true });
    } catch (error) {
        // Some firmware builds expose readdir(path) but ignore Dirent options.
        entries = await api.readdir(path);
    }

    if (!Array.isArray(entries)) {
        throw new Error('File-system readdir() did not return an array');
    }

    const result = [];

    for (const entry of entries) {
        const name = typeof entry === 'string' ? entry : entry && entry.name;
        if (!name || name === '.' || name === '..') continue;

        let isDirectory = getEntryType(entry);

        if (isDirectory === null && typeof api.stat === 'function') {
            try {
                const info = await api.stat(joinPath(path, name));
                isDirectory = getEntryType(info);
            } catch (error) {
                // An entry that cannot be stat'ed is skipped rather than
                // incorrectly presented as a readable book.
                continue;
            }
        }

        if (isDirectory === null) {
            throw new Error('Cannot determine whether "' + name + '" is a directory');
        }

        result.push({
            name,
            isDirectory() {
                return isDirectory;
            }
        });
    }

    return result;
}

function decodeBytes(value) {
    let bytes = value;

    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
    }

    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView
        && ArrayBuffer.isView(bytes)) {
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(bytes);
        }

        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return decodeURIComponent(escape(binary));
    }

    return null;
}

async function readTextFile(path) {
    const { api } = await loadFileSystem();
    const value = await api.readFile(path);

    if (typeof value === 'string') return value;
    if (value && typeof value.text === 'string') return value.text;
    if (value && typeof value.content === 'string') return value.content;
    if (value && typeof value.data === 'string') return value.data;

    const decoded = value && decodeBytes(value);
    if (decoded !== null) return decoded;

    if (value && typeof value.toString === 'function'
        && value.constructor && value.constructor.name === 'Buffer') {
        return value.toString('utf8');
    }

    throw new Error('File-system readFile() did not return UTF-8 text for: ' + path);
}

export {
    loadFileSystem,
    readDirectory,
    readTextFile
};
