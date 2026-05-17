#!/bin/bash

npm run build:prod
amr_file=$(ls *.amr)
base_name="${amr_file%%.*}"

adb push $amr_file /userdisk/Favorite/
rm -f *.amr

adb shell "miniapp_cli install /userdisk/Favorite/$amr_file"
adb shell "miniapp_cli start $base_name"