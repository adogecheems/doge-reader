<template>
    <div>
        <div class="container">
            <ButtonColumn>
                <IconButton :icon="require('../../assets/back.png?base64')" @click="back" />
                <IconButton :icon="require('../../assets/love.png?base64')" @click="love" />
                <IconButton :icon="require('../../assets/menu.png?base64')" @click="openMenu" />
            </ButtonColumn>
            <div class="loading-area" v-if="loading">
                <text class="loading">少女祈祷中...</text>
            </div>
            <div style="flex: 1;" v-else-if="reader.mode === 'page'">
                <text class="content" :class="{ 'content-larger': isLarger }">{{ reader.content }}</text>
                <div class="prev" @click="prev" />
                <div class="next" @click="next" />
            </div>
            <scroller style="flex: 1;" @scroll="setOffsetY" v-else-if="reader.mode === 'scroll'" over-scroll="50px"
                over-fling="50px">
                <div style="min-height: 100%;">
                    <div ref="start" style="height: 10vh;" />
                    <PageTurningButton :icon="require('../../assets/back.png?base64')" v-if="reader.chapterIndex !== 0"
                        text="上一页" @click="prevChapter" style="margin: 6vh 4vh 7vh 0;" />
                    <text class="content" :class="{ 'content-larger': isLarger }">{{ reader.content }}</text>
                    <PageTurningButton :icon="require('../../assets/next.png?base64')"
                        v-if="reader.chapterIndex < reader.book.getChapterCount() - 1" text="下一页" @click="nextChapter"
                        style="margin: 7vh 4vh 6vh 0;" />
                    <div ref="end" style="height: 10vh;" />
                </div>
            </scroller>
        </div>
        <Drawer v-if="!loading">
            <scroller style="height: 100%;" over-scroll="50px" over-fling="50px">
                <text class="lower-title">章节</text>
                <MenuCard :text="reader.book.getChapterTitle(index - 1)" v-for="index in reader.book.getChapterCount()"
                    :key="index" :active="index - 1 === reader.chapterIndex" @click="loadChapter(index - 1)" />
            </scroller>
        </Drawer>
        <Toast />
        <div v-if="isDebug"
            style="position: absolute; top: 0; right: 0; padding: 0; background-color: #000000; opacity: 0.7;">
            <text style="font-size: 6vh; color: white;">
                mode: {{ reader.mode }},
                fontSize: {{ reader.fontSize }},
                lineHeight: {{ reader.lineHeight }},
                viewPort: {{ reader.viewportWidth }}*{{ reader.viewportHeight }},
                chapterIndex: {{ reader.chapterIndex }},
                offset: {{ reader.offset }},
                offsetY: {{ reader.offsetY }}
            </text>
        </div>
    </div>
</template>

<script>
const sync_wait_time = 25;
const env = $falcon.env;
const w = env.deviceWidth;
const h = env.deviceHeight;

import ButtonColumn from "../../components/button-column.vue";
import Drawer from "../../components/drawer.vue";
import IconButton from "../../components/icon-button.vue";
import MenuCard from "../../components/menu-card.vue";
import PageTurningButton from "../../components/page-turning-button.vue";
import Toast from "../../components/toast.vue";

import BookParser from '../../utils/BookParser/BookParser.js';
import Reader from "../../utils/Reader/Reader.js";
import Storage from "../../utils/Storage/Storage.js";

const storage = new Storage();

export default {
    name: 'reader',
    components: {
        ButtonColumn,
        IconButton,
        MenuCard,
        Toast,
        Drawer,
        PageTurningButton
    },
    data() {
        return {
            loading: true,
            reader: null,
            isLarger: false,
            isListeningScroll: false,
            isDebug: false
        }
    },
    async created() {
        const parser = new BookParser(this.$page.options.path);
        const book = await parser.load();

        this.isLarger = await storage.get('isLarger');
        this.isDebug = await storage.get('isDebug');

        this.reader = new Reader(book, {
            mode: await storage.get('mode') || 'page',
            fontSize: this.isLarger ? 12 : 10,
            lineHeight: this.isLarger ? 16 : 14,
            viewportWidth: w - 0.39 * h,
            viewportHeight: h
        });

        if (this.$page.options.progress) {
            this.reader.setProgress(JSON.parse(this.$page.options.progress));
        } else {
            if (await storage.getItem(this.$page.options.path)) {
                this.reader.setProgress(await storage.getItem(this.$page.options.path));
            }
        }

        this.loading = false;

        if (this.reader.mode === 'scroll') {
            await this.go('start', this.reader.getOffsetY() + 0.38 * h);
            this.isListeningScroll = true;
        }
    },
    methods: {
        back() {
            this.save().then(() => {
                this.$page.finish();
            });
        },
        async save() {
            await storage.addItem(this.$page.options.path, this.reader.getProgress());
        },
        love() {
            storage.addItem(this.$page.options.path, this.reader.getProgress(), 'favorite').then(() => {
                $falcon.trigger('toast', { text: '书签已保存' });
            });
        },
        prev() {
            this.reader.prev();
        },
        next() {
            this.reader.next();
        },
        prevChapter() {
            this.reader.prevChapter();
            this.go('end');
        },
        nextChapter() {
            this.reader.nextChapter();
            this.go('start');
        },
        openMenu() {
            $falcon.trigger('drawer', { show: true });
        },
        go(ref, offset = 0) {
            return new Promise(resolve => {
                setTimeout(() => {
                    this.$page.$dom.scrollToElement(this.$refs[ref], { offset });
                    resolve();
                }, sync_wait_time);
            });
        },
        setOffsetY(event) {
            if (this.reader.mode !== 'scroll' || !this.isListeningScroll) return;
            this.reader.setOffsetY(event.contentOffset.y - 0.38 * h);
        },
        loadChapter(index) {
            this.reader.go(index);
            $falcon.trigger('drawer', { show: false });
            this.go('start');
        },
        onShow() {
            this._backpressed = () => {
                this.back();
            }

            this.$page.$npage.setSupportBack(false);
            this.$page.$npage.on("backpressed", this._backpressed);
        },
        onHide() {
            this.save();

            this.$page.$npage.setSupportBack(true);
            this.$page.$npage.off("backpressed", this._backpressed);
        },
    }
}
</script>

<style lang="less" scoped>
@import "../../styles/common.less";
@import "../../styles/md-color.less";

.loading-area {
    flex: 1;
    justify-content: center;
    align-items: center;
}

.content {
    width: 100%;
    font-size: 10vh;
    line-height: 14vh;
    margin-top: 1.5vh;
    color: @on-neutral;
}

.content-larger {
    font-size: 12vh;
    line-height: 16vh;
    margin-top: 2.5vh;
}

.prev,
.next {
    position: absolute;
    width: 50%;
    height: 100%;
    top: 0;
    left: 0;
}

.next {
    left: 50%;
}

.lower-title {
    margin: 8vh 0 6vh 0;
    font-size: 10vh;
    color: @outline;
}
</style>