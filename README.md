# מי חונה?

אפליקציה קטנה לשני הטלפונים: מי חונה בחנייה (רכב 1, רכב 2, אורח, או ריקה). מסונכרנת חי, עם התראה לטלפון השני.

- האתר: `docs/` (PWA בעברית, מתפרסם ב-GitHub Pages מהענף `main`, תיקיית `/docs`).
- סנכרון והתראות: Cloudflare Worker משלה בתיקיית `worker/` (`who-parks`, עם KV משלה `who-parks-rooms`), נפרד לגמרי מכל אפליקציה אחרת. נפרס אוטומטית ב-`.github/workflows/deploy-worker.yml` (דורש הסודות `CLOUDFLARE_API_TOKEN` ו-`CLOUDFLARE_ACCOUNT_ID` ב-GitHub). הקוד הסודי של החדר נשמר רק בטלפונים ובקישור ההזמנה, לא בקוד.
- הריפו ציבורי: אין לשים כאן קודים, כתובות פרטיות או שמות.
- בדיקות: `node tests/worker.test.mjs` (Worker) ו-`./tests/run-all.sh` (דורש node ו-playwright גלובלי).
