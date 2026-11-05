import { readTextFile } from '../FileSystem/FileSystem.js';
import Book from './Book.js';

export default class BookParser {
    constructor(path) {
        this.path = path;
        this.text = '';
        this.chapters = []; // { title, start, end }
    }

    async load() {
        this.text = await readTextFile(this.path);
        this.text = this.text.replace(/\\r\\n/g, '\\n');
        this._parse();
        return new Book(this.text, this.chapters);
    }

    _parse() {
        const text = this.text;

        // 常见标题模式（尽量覆盖中英文 + 数字）
        const pattern = new RegExp(
            [
                // 中文章节
                '^(第[0-9一二三四五六七八九十百千万零]+[章节卷回部篇].{0,30})$',

                // 前言/后记等
                '^(前言|序章|序言|楔子|引子|后记|尾声|番外|附录).{0,20}$',

                // 英文 Chapter
                '^(chapter|prologue|epilogue)\\\\s+[0-9ivxlcdm]+.*$',

                // 1. xxx（可带文字）
                '^([0-9]{1,4})\\\\.\\\\s*[^\\\\n]{0,30}$',

                // 1.2.3（纯数字层级，不应接文字）
                '^([0-9]+\\\\.){2,}[0-9]+$'
            ].join('|'),
            'im'
        );

        const lines = text.split('\\n');
        let index = 0;
        let matches = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (!line) {
                index += lines[i].length + 1;
                continue;
            }

            if (pattern.test(line)) {
                // ===== 伪标题过滤 =====
                // 关键：避免 "1."、"2." 这种段落编号
                const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';

                // 条件：
                // 1. 下一行必须是空行 或 明显正文（长度较长）
                // 2. 标题长度不能太短（防止 "1."）
                const isShort = line.length <= 2;
                const looksLikeParagraph = nextLine.length > 0 && nextLine.length < 15;

                if (isShort || looksLikeParagraph) {
                    index += lines[i].length + 1;
                    continue;
                }

                matches.push({
                    title: line,
                    pos: index
                });
            }

            index += lines[i].length + 1;
        }

        // ===== fallback =====
        if (matches.length === 0) {
            this._fallback();
            return;
        }

        // ===== 前言处理 =====
        if (matches[0].pos > 0) {
            this.chapters.push({
                title: '前言',
                start: 0,
                end: matches[0].pos
            });
        }

        // ===== 构建章节 =====
        for (let i = 0; i < matches.length; i++) {
            const cur = matches[i];
            const next = matches[i + 1];

            this.chapters.push({
                title: cur.title,
                start: cur.pos,
                end: next ? next.pos : text.length
            });
        }
    }

    _fallback() {
        const size = 3000;
        let i = 0;
        let count = 1;

        while (i < this.text.length) {
            this.chapters.push({
                title: `第${count}节`,
                start: i,
                end: Math.min(i + size, this.text.length)
            });
            i += size;
            count++;
        }
    }
}
