<template>
    <div class="info-card">
        <text class="item-text">{{ item }}</text>
        <div style="flex: 1;"><text class="value-text">{{ value }}</text></div>
    </div>
</template>

<script>
export default {
    name: "InfoCard",
    props: {
        item: { type: String, required: true },
        value: { type: String, required: true }
    }
}
</script>

<style lang="less" scoped>
@import "../styles/md-color.less";

.info-card {
    width: 80%;
    margin-bottom: 5vh;
    padding: 8vh 12vh;
    border-radius: 8vh;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    background-color: @primary;
}

.item-text {
    color: @on-primary;
    margin-right: 5vh;
    font-size: 11vh;
}

.value-text {
    text-align: right;
    color: @neutral;
    font-size: 10vh;
}
</style>