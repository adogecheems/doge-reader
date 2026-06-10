<template>
    <div class="wrapper" @click="$emit('click')">
        <div style="flex: 1;"><text class="name">{{ name }}</text></div>
        <text class="time">{{ time }}</text>
    </div>
</template>

<script>
export default {
    name: "HistoryCard",
    props: {
        name: { type: String, required: true },
        time: { type: String, required: true },
    },
};
</script>

<style lang="less" scoped>
@import "../styles/md-color.less";

.wrapper {
    min-height: 30vh;
    background-color: @neutral;
    border-radius: 6vh;
    padding: 3vh 10vh;
    justify-content: space-between;
    align-items: center;
    flex-direction: row;
}

.wrapper:active {
    opacity: 0.6;
}

.name {
    font-size: 10vh;
    margin-right: 5vh;
    color: @on-neutral;
}

.time {
    font-size: 8vh;
    color: @outline;
}
</style>