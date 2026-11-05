/**
 * File access adapter for the dictionary-pen runtime.
 *
 * This device does not expose Node's "fs" module. PenMusic documents
 * global.execShell as the portable fallback, so all file operations here
 * go through that runtime API instead of importing Node-only modules.
 */

function getExecShell() {
    // Different firmware builds expose the injected bridge under slightly
    // different global scopes. Resolve it lazily so desktop preview can load.
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
    const exec = getExecShell();
    const result = await exec(command);
    const output = getOutput(result);

    // Some wrappers return {status, output}; string-only firmware builds
    // generally reject commands by returning an error message.
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
