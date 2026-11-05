/**
 * File access adapter for the dictionary-pen runtime.
 *
 * This device does not expose Node's "fs" module. PenMusic documents
 * global.execShell as the portable fallback, so all file operations here
 * go through that runtime API instead of importing Node-only modules.
 */

async function getExecShell() {
    // Some firmware exposes an already-instantiated global object.
    if (typeof global !== 'undefined' && global
        && typeof global.execShell === 'function') {
        return global.execShell.bind(global);
    }

    if (typeof globalThis !== 'undefined') {
        if (globalThis.global && typeof globalThis.global.execShell === 'function') {
            return globalThis.global.execShell.bind(globalThis.global);
        }
        if (typeof globalThis.execShell === 'function') {
            return globalThis.execShell.bind(globalThis);
        }
    }

    // PenMusic documents "global" as a system module. On builds where it is
    // exposed as a module rather than a global variable, instantiate it here.
    try {
        const module = await import('global');
        const Global = module.default || module.Global;
        const api = Global && typeof Global === 'function'
            ? new Global()
            : (Global || module);

        if (api && typeof api.execShell === 'function') {
            return api.execShell.bind(api);
        }
    } catch (error) {
        // Keep the final error focused on the missing platform capability.
    }

    throw new Error('当前设备未提供 global.execShell，无法访问本地文件');
}

function shellQuote(value) {
    // POSIX single-quote escaping: ' -> '\''
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function getOutput(result) {
    if (typeof result === 'string') return result;
    if (result == null) return '';
    if (typeof result.output === 'string') return result.output;
    if (typeof result.stdout === 'string') return result.stdout;
    if (typeof result.data === 'string') return result.data;
    if (typeof result.text === 'string') return result.text;
    return String(result);
}

async function execShell(command) {
    const exec = await getExecShell();
    const result = await exec(command + '\\nprintf "\\n__READEX_STATUS__%s\\n" "$?"');
    const output = getOutput(result);
    const match = output.match(/\\n__READEX_STATUS__(\\d+)\\s*$/);

    if (match) {
        const body = output.slice(0, match.index);
        if (Number(match[1]) !== 0) {
            throw new Error(body.trim() || ('Shell command failed: ' + command));
        }
        return body;
    }

    // A few wrappers return structured status instead of preserving the
    // shell marker; support those without assuming stdout is always present.
    if (result && typeof result === 'object'
        && typeof result.status === 'number' && result.status !== 0) {
        throw new Error(output || ('Shell command failed: ' + command));
    }

    return output;
}

async function readDirectory(path) {
    const quotedPath = shellQuote(path);
    // -A omits . and ..; -p appends '/' to directory names. This avoids
    // relying on Node Dirent objects or unsupported fs.readdir options.
    const output = await execShell('LC_ALL=C ls -1Ap ' + quotedPath + ' 2>&1');
    const lines = output.split(/\r?\n/).filter(Boolean);

    if (lines.some(line => /^(ls:|cannot access|permission denied|not found)/i.test(line.trim()))) {
        throw new Error(lines.join('\n'));
    }

    return lines.map(line => {
        const isDirectory = line.endsWith('/');
        const name = isDirectory ? line.slice(0, -1) : line;
        return {
            name,
            isDirectory() {
                return isDirectory;
            }
        };
    }).filter(entry => entry.name && entry.name !== '.' && entry.name !== '..');
}

async function readTextFile(path) {
    // cat preserves UTF-8 text and does not require the unavailable fs module.
    return execShell('cat ' + shellQuote(path) + ' 2>&1');
}

export {
    execShell,
    readDirectory,
    readTextFile
};
