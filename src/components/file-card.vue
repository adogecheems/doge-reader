<template>
    <div class="card" @click="$emit('click')">
        <div class="wrapper">
            <image class="icon" :src="node.isDirectory()
                ? require('../assets/folder-icon.png?base64')
                : require('../assets/file-icon.png?base64')" />
            <text class="text">{{ node.name }}</text>
        </div>
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

.card {
    min-height: 30vh;
    background-color: @neutral;
    border-radius: 6vh;
    padding: 3vh 7vh;
    justify-content: center;
}

.card:active {
    opacity: 0.6;
}

.wrapper {
    flex-direction: row;
    align-items: center;
}

.icon {
    width: 15vh;
    height: 15vh;
    margin-right: 6vh;
}

.text {
    font-size: 10vh;
    color: @on-neutral;
}
</style>