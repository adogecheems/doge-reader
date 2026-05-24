<template>
    <div class="card">
        <div style="max-width: 60%;">
            <text class="item-text">{{ item }}</text>
            <text class="desc-text">{{ desc }}</text>
        </div>
        <slot />
    </div>
</template>

<script>
export default {
    name: "SettingCard",
    props: {
        item: { type: String, required: true },
        desc: { type: String, required: true },
    }
}
</script>

<style lang="less" scoped>
@import "../styles/md-color.less";

.card {
    margin-bottom: 5vh;
    padding: 8vh 12vh;
    border-radius: 8vh;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    background-color: @neutral;
}

.item-text {
    color: @on-neutral;
    font-size: 10vh;
}

.desc-text {
    color: @outline;
    font-size: 8vh;
}
</style>