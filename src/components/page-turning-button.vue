<template>
    <div class="button" @click="$emit('click')">
        <image class="icon" :src="icon" />
        <text class="text">{{ text }}</text>
    </div>
</template>

<script>
export default {
    name: 'PageTurningButton',
    props: {
        text: { type: String, required: true },
        icon: { type: String, required: true }
    },
}
</script>

<style lang="less" scoped>
@import "../styles/md-color.less";

.button {
    height: 24vh;
    border-radius: 8vh;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    background-color: @neutral;
}

.button:active {
    opacity: 0.6;
}

.icon {
    width: 15vh;
    height: 15vh;
}

.text {
    margin-left: 4vh;
    font-size: 10vh;
    color: @on-neutral
}
</style>