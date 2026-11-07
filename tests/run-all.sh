#!/usr/bin/env bash
# בדיקת ממשק מלאה עם שני "טלפונים" (Playwright). דורש node 20+ ו-playwright גלובלי. פורטים 8780/8781.
cd "$(dirname "$0")" || exit 1
node mock-server.mjs & PID=$!
sleep 1
timeout 170 node ui.test.mjs; RC=$?
kill $PID 2>/dev/null
exit $RC
