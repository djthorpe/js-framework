// Provider class to be subclassed by an actual provider

import Error from './error';
import Emitter from './emitter';

// ////////////////////////////////////////////////////////////////////////////
// EVENTS

const EVENT_ROOT = 'provider';

/**
 * Request start event, which is emitted when a request is initiated.
 *
 * @event Provider#provider:started
 * @arg {Provider} sender - The provider that emitted the event.
 * @arg {string} url - The url of the endpoint.
 */
const EVENT_STARTED = `${EVENT_ROOT}:started`;

/**
 * Request completed event, which is emitted when a request is successfully completed.
 *
 * @event Provider#provider:completed
 * @arg {Provider} sender - The provider that emitted the event.
 * @arg {boolean} changed - When true, indicates that the request resulted in a change
 *   to the objects stored in the provider.
 */
const EVENT_COMPLETED = `${EVENT_ROOT}:completed`;

/**
 * Request error event, which is emitted when a request is not completed successfully.
 *
 * @event Provider#provider:error
 * @arg {Provider} sender - The provider that emitted the event.
 * @arg {Error} error - Provides the reason for the request not completing
 *   successfully.
 */
const EVENT_ERROR = `${EVENT_ROOT}:error`;

/**
 * Object added event, which is emitted when a request adds a new object to the provider.
 *
 * @event Provider#provider:added
 * @arg {Provider} sender - The provider that emitted the event.
 * @arg {Model} object - Provides the reason for the request not completing
 *   successfully.
 */
const EVENT_ADDED = `${EVENT_ROOT}:added`;

/**
 * Object changed event, which is emitted when a request replaces an existing object.
 *
 * @event Provider#provider:changed
 * @arg {Provider} sender - The provider that emitted the event.
 * @arg {Model} object - The object which has been added to the provider.
 * @arg {Model} existing - The object which has been replaced in the provider.
 */
const EVENT_CHANGED = `${EVENT_ROOT}:changed`;

/**
 * Object deleted event, which is emitted when a request removes an object from
 * the provider.
 *
 * @event Provider#provider:deleted
 * @arg {Provider} sender - The provider that emitted the event.
 * @arg {Model} object - The object which has been deleted from the provider.
 */
const EVENT_DELETED = `${EVENT_ROOT}:deleted`;

// ////////////////////////////////////////////////////////////////////////////

/**
 * Provider requests data from a remote endpoint.
 * @class
 * @implements {Emitter}
 * @classdesc The provider can store model objects which can be retrieved after
 *  a request is completed. If no model is provided then Object types will be emitted.
 *  Add event listeners to tap into the request lifecycle.
 *  To create a provider, with a model constructor and optionally a base URL for
 *  requests.
 *
 * @arg {Model=} constructor - The model used to create objects from data.
 * @arg {string=} origin - The base URL used for making requests.
 *
 * @property {Object[]} objects - The objects stored in the provider.
 * @property {string[]} keys - The unique keys for objects stored in the provider.
 *
 */
export default class Provider extends Emitter {
  constructor(constructor, origin) {
    super();
    this.$origin = origin || '';
    this.$constructor = constructor || Object;
    this.$objs = new Map();
    this.$timer = null;
  }

  /**
  * Request data from a remote source, either once or by interval.
  * Subsequent calls to this function will cancel any existing
  * timers.
  * @param {string} url - The endpoint of the data provider.
  * @param {Object} req - Request data. See the documentaton for fetch.
  * @param {number} interval - If provided, the number of milliseconds between each request.
  * @fires Provider#provider:started
  * @fires Provider#provider:completed
  * @fires Provider#provider:error
  * @fires Provider#provider:added
  * @fires Provider#provider:changed
  * @fires Provider#provider:deleted
  */
  request(url, req, interval) {
    this.cancel();
    if (!this.$timer) {
      this.$fetch(url, req);
    }
    if (interval) {
      this.$timer = setInterval(this.$fetch.bind(this, url, req), interval);
    }
  }

  /**
  * Perform a request without interrupting any existing request interval timer.
  * @param {string} url - The endpoint of the data provider.
  * @param {Object} req - Request data. See the documentaton for fetch.
  * @fires Provider#provider:started
  * @fires Provider#provider:completed
  * @fires Provider#provider:error
  * @fires Provider#provider:added
  * @fires Provider#provider:changed
  * @fires Provider#provider:deleted
  */
  do(url, req) {
    this.$fetch(url, req);
  }

  /**
  * Cancel any existing request interval timer.
  */
  cancel() {
    if (this.$timer) {
      clearTimeout(this.$timer);
      this.$timer = null;
    }
  }

  $fetch(url, req) {
    let status;
    let changed = false;
    let absurl = this.$origin + (url || '');
    if (!absurl.hasPrefix('/')) {
      absurl = `/${absurl}`;
    }
    this.dispatchEvent(EVENT_STARTED, this, absurl);
    fetch(absurl, req)
      .then((response) => {
        status = response;
        const contentType = response.headers ? response.headers.get('Content-Type') || '' : '';
        switch (contentType.split(';')[0]) {
          case 'application/json':
          case 'text/json':
            return response.json();
          case 'text/plain':
          case 'text/html':
            return response.text();
          default:
            return response.blob();
        }
      })
      .then((data) => {
        if (!status.ok) {
          if (typeof (data) === 'object' && data.reason) {
            throw new Error(data.reason, data.code);
          } else {
            throw new Error(status.statusText, status.status);
          }
        } else if (typeof (data) === 'object' && Array.isArray(data)) {
          if (this.$array(data)) {
            changed = true;
          }
        } else {
          const result = this.$object(data);
          if (result[1]) {
            changed = true;
          }
        }
      })
      .then(() => {
        this.dispatchEvent(EVENT_COMPLETED, this, changed);
      })
      .catch((error) => {
        if (error instanceof Error) {
          this.dispatchEvent(EVENT_ERROR, this, error);
        } else {
          throw error;
        }
      });
  }

  static $key(obj) {
    return typeof obj === 'object' ? obj.key : null;
  }

  static $equals(a, b) {
    return a.$equals ? a.$equals(b) : a === b;
  }

  $object(data) {
    const obj = new this.$constructor(data);
    const key = this.constructor.$key(obj);
    let changed = true;
    if (key && this.$objs.has(key)) {
      const existing = this.$objs.get(key);
      this.$objs.set(key, obj);
      if (this.constructor.$equals(obj, existing) === false) {
        this.dispatchEvent(EVENT_CHANGED, this, obj, existing);
      } else {
        changed = false;
      }
    } else {
      if (key) {
        this.$objs.set(key, obj);
      }
      this.dispatchEvent(EVENT_ADDED, this, obj);
    }
    return [key, changed];
  }

  $array(data) {
    let changed = false;
    const mark = new Map();

    // Mark existing objects
    this.$objs.forEach((_, key) => {
      mark.set(key, true);
    });

    // Add and change objects
    data.forEach((elem) => {
      const result = this.$object(elem);
      if (result[0]) {
        mark.delete(result[0]);
      }
      if (result[1]) {
        changed = true;
      }
    });

    // Delete objects which are still marked
    this.$objs.forEach((elem, key) => {
      if (mark.get(key)) {
        changed = true;
        this.dispatchEvent(EVENT_DELETED, this, elem);
        this.$objs.delete(key);
      }
    });

    // Return true if the items were changed
    return changed;
  }

  get objects() {
    return Array.from(this.$objs.values());
  }

  get keys() {
    return Array.from(this.$objs.keys());
  }

  /**
  * Return an object which is registered with a key.
  * @param {string} key - The unique key for the model object.
  */
  objectForKey(key) {
    return this.$objs.get(key);
  }

  /**
  * Remove any registered objects.
  */
  clear() {
    this.$objs.clear();
  }
}
