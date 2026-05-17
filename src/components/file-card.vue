<template>
    <div class="wrapper" @click="$emit('click')">
        <image class="icon" :src="node.isDirectory()
            ? require('../assets/folder-icon.png?base64')
            : require('../assets/file-icon.png?base64')" />
        <text class="text">{{ node.name }}</text>
    </div>
</template>

<script>
export default {
    name: "FileCard",
    props: {
        node: { type: Object, required: true },
    },
};
</script>

<style lang="less" scoped>
@import "../styles/md-color.less";

.wrapper {
    min-height: 30vh;
    background-color: @neutral;
    border-radius: 6vh;
    padding: 3vh 7vh;
    align-items: center;
    flex-direction: row;
}

.wrapper:active {
    opacity: 0.6;
}

.icon {
    width: 15vh;
    height: 15vh;
    margin-right: 6vh;
}

.text {
    max-width: 90%;
    font-size: 10vh;
    color: @on-neutral;
}
</style>