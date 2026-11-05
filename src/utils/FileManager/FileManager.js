import { readDirectory } from '../FileSystem/FileSystem.js';

export default class FileManager {
    constructor(root = "/userdisk/Favorite") {
        this._stack = root.split('/').filter(Boolean);
        this._version = 0;

        this.loading = true;
        this.error = false;
        this.nodeList = [];

        this._refresh();
    }

    get cwd() {
        return '/' + this._stack.join('/');
    }

    async _refresh() {
        const version = ++this._version;
        this.loading = true;
        this.error = false;

        try {
            const list = await readDirectory(this.cwd);
            if (version !== this._version) return;

            this.nodeList = list
                .filter(node =>
                    node.isDirectory() || node.name.toLowerCase().endsWith('.txt')
                )
                .sort((a, b) => {
                    if (a.isDirectory() && !b.isDirectory()) return -1;
                    if (!a.isDirectory() && b.isDirectory()) return 1;
                    return a.name.localeCompare(b.name);
                });

        } catch (e) {
            if (version !== this._version) return;
            this.nodeList = [];
            this.error = true;
        }

        this.loading = false;
    }

    chooseFile(index) {
        const node = this.nodeList[index];
        if (!node) return null;

        if (node.isDirectory()) {
            this._stack.push(node.name);
            this._refresh();
            return null;
        }

        return `${this.cwd}/${node.name}`;
    }

    goBack() {
        if (this._stack.length <= 1) return false;

        this._stack.pop();
        this._refresh();
        return true;
    }
}
