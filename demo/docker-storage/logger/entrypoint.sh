#!/bin/sh
dd if=/dev/zero of=/shared/bloat.log bs=1M count=9 2>/dev/null
while true; do sleep 60; done
