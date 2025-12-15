import { ONE_SECOND } from './date'
import { wait } from './flow'
import { MaybePromise } from './types/utilTypes'

type Opts<T> = {
  batchOperation: (entities: [T, ...T[]]) => MaybePromise<any>
  initQueue?: T[]
  interval?: number
  maxEntitiesPerOperation?: number
  debug?: boolean
  /** Optionally provide custom equality function used for deduping */
  isEqual?: (a: T, b: T) => boolean
}

/**
 * This structure is useful for spacing out performance-intensive background
 * work, and also for batching operations.
 *
 * For example, it was built to support logging data to a persisted file. In
 * this scenario, there could be tens or hundreds of such requests made very
 * quickly. This queue structure enables pushing immediately to the queue, then
 * waiting some interval before taking action.
 *
 * The consumer specifies what (primitive) data type makes up the actual queue,
 * and what batch action to perform on the queue.
 */
class ThrottledBatchQueue<T> {
  private queue: T[]
  private isRunning = false
  private isPaused = false
  private interval: number
  /** When performing batch operations on the queue, only take a slice of this
   * length, if provided. */
  private maxEntitiesPerOperation: number | null
  private batchOperation: (entities: [T, ...T[]]) => MaybePromise<any>
  private debug: boolean
  private isEqual: (a: T, b: T) => boolean

  constructor({
    batchOperation,
    initQueue = [],
    interval = ONE_SECOND * 5,
    maxEntitiesPerOperation,
    debug = false,
    isEqual = (a, b) => a === b,
  }: Opts<T>) {
    this.queue = initQueue
    this.interval = interval
    this.maxEntitiesPerOperation = maxEntitiesPerOperation || null
    this.batchOperation = batchOperation
    this.debug = debug
    this.isEqual = isEqual
  }

  private debugLog(msg: any) {
    if (this.debug) console.log(msg)
  }

  /** Get a portion of the queue back as an array. If `maxEntitiesPerOperation`
   * is null, it will return the whole queue. This will also update the queue to
   * remove the elements that are returned, similar to `Array.shift` */
  private shiftQueue() {
    const clone = [...this.queue]
    if (!this.maxEntitiesPerOperation) {
      this.queue = []
      return clone
    }
    const batch = clone.splice(0, this.maxEntitiesPerOperation)
    this.queue = clone
    return batch
  }

  private async run() {
    if (this.isRunning) throw new Error("File d'attente déjà en cours")
    if (this.isPaused) throw new Error('Exécution appelée pendant la pause')
    if (this.queue.length === 0) {
      this.debugLog("Plus rien en attente d'exécution.")
      return
    }
    this.isRunning = true
    const batchEntities = this.shiftQueue()
    this.debugLog(`Exécution d'une opération par lots sur ${batchEntities.length} entités, ${this.queue.length} restante.`)
    if (this.queue.length > 0) this.snoozeRun()
    if (batchEntities.length > 0) await this.batchOperation(batchEntities as [T, ...T[]])
    // This smells, but I want to ensure that snoozeRun gets called ASAP, but
    // also make sure that if the queue gets added to during the batch
    // operation, that those entities get detected.
    if (this.queue.length > 0) this.snoozeRun()
    this.isRunning = false
  }

  private snoozeRun() {
    if (this.isPaused) {
      this.debugLog("Exécution de la fonction Snooze appelée pendant la pause de la file d'attente.")
      return
    }
    wait(this.interval, () => {
      if (this.queue.length === 0) {
        this.debugLog("Après la mise en veille, il ne reste plus rien à exécuter dans la file d'attente.")
        return
      }
      if (this.isRunning) this.snoozeRun()
      else this.run()
    })
  }

  push(...entities: T[]) {
    const newEntities = entities.filter((e) => !this.queue.some((queuedEntity) => this.isEqual(queuedEntity, e)))
    if (newEntities.length === 0) {
      this.debugLog("Push : toutes les entités poussées sont dans la file d'attente.")
      return
    }
    for (const entity of newEntities) this.queue.push(entity)
    // If the queue is already running, it should automatically include the
    // pushed entities
    if (!this.isRunning) this.run()
  }

  /** Halts queue execution after any currently running operations complete */
  pause() {
    this.debugLog("La file d'attente a été interrompue.")
    this.isPaused = true
  }

  resume() {
    this.debugLog("La file d'attente a repris.")
    this.isPaused = false
    if (!this.isRunning) this.snoozeRun()
  }
}

export default ThrottledBatchQueue
