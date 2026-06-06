# Historical Backfill

The dashboard exposes a historical backfill form that queues BullMQ jobs with:

- provider
- country
- collection area
- from/to timestamps
- chunk size in hours

V1 queues and logs the job. Real provider historical pagination, chunk execution, pause/resume and progress tracking are TODOs for integration work.
