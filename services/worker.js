const supabase = require("./db");
const logger = require("../utils/logger");
const { runBulkSend } = require("../bulkSender");

let interval = 5000; // start at 5 seconds
let isRunning = false;
let timeoutId = null;

async function processJob(job) {
  try {
    logger.info(`[Worker] Started job ${job.id} of type ${job.type}`);
    
    if (job.type === "bulk_send") {
      // payload: { sportKey, templateKey, dryRun, limit }
      const results = await runBulkSend(job.payload);
      
      // Update as completed
      await supabase.from("jobs")
        .update({ status: "completed", updated_at: new Date() })
        .eq("id", job.id);
        
      logger.info(`[Worker] Job ${job.id} completed. Sent: ${results?.sent}, Failed: ${results?.failed}`);
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
  } catch (err) {
    logger.error(`[Worker] Job ${job.id} failed:`, err.message);
    
    // Update as failed
    await supabase.from("jobs")
      .update({ 
        status: "failed", 
        error_message: err.message, 
        updated_at: new Date() 
      })
      .eq("id", job.id);
  }
}

async function workerLoop() {
  if (!isRunning) return;

  try {
    // Attempt to atomically claim the next pending or stuck job
    const { data: job, error } = await supabase.rpc("claim_next_job");

    if (error) {
      if (error.message.includes("Could not find the function")) {
        // Run once warning to avoid log spam if user hasn't run the SQL yet
        logger.warn("[Worker] 'claim_next_job' RPC not found. Please run the SQL snippet in Supabase.");
      } else {
        logger.error("[Worker] RPC Error:", error.message);
      }
    }

    if (job && job.id) {
      // We found work! Speed up the polling cycle
      interval = 1000;
      await processJob(job);
    } else {
      // Idle, strictly back off up to 15 seconds
      interval = Math.min(interval + 1000, 15000);
    }
  } catch (err) {
    logger.error("[Worker] Critical Loop Error:", err.message);
    interval = Math.min(interval + 2000, 15000); // Back off on fatal error
  }

  // Schedule next iteration dynamically
  timeoutId = setTimeout(workerLoop, interval);
}

function startWorker() {
  if (isRunning) return;
  isRunning = true;
  logger.info("[Worker] Initialized dynamic job polling mechanism.");
  workerLoop();
}

function stopWorker() {
  isRunning = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  logger.info("[Worker] Shutdown.");
}

module.exports = { startWorker, stopWorker };
