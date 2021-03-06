/* eslint-disable func-names */

import Error from './error';

// ////////////////////////////////////////////////////////////////////////////
// CONSTANTS

// Valid type specifications:
//   string
//   []string (array of string)
//   {}string (map of string)
//   _id string (string with alias)
const REGEXP_ALIASED = /^([A-Za-z0-9-_]*)\s+(\{\}|\[\])?(\w+)$/i;
const REGEXP_NOTALIASED = /^()(\{\}|\[\])?(\w+)$/i;

// ////////////////////////////////////////////////////////////////////////////

/**
 * Model manages data transfer between provider, form and internal representation.
 * @class
 * @classdesc This class is used as a base class to a model. You should extend
 * this class and call the define method to describe the data model properties. When constructing
 * a model, you can then access your properties as you would any other object.
 *
 * @arg {Object} data - The data which is parsed and used to construct the model instance.
 *
 * @property {string} $json - Returns JSON representation of the model values.
 * @property {string} $className - Returns the class name of the model.
 *
 * @throws Error
 */
export default class Model {
  constructor(data) {
    // Get prototype
    const classKey = this.constructor.name;
    const proto = Model.models[classKey];
    if (!proto) {
      throw new Error(`Missing model definition for ${classKey}`);
    }

    // Set prototype of instance prototype
    Object.setPrototypeOf(Object.getPrototypeOf(this), proto);

    // Set values of object
    this.$setall(data);
  }

  /**
   * Define the object model. The model supports string, number, boolean and date
   * as native values, and map, object and array as collections. You can define
   * the model as an array of properties, each property is a string with an optional
   * alias (the data key of the external representation) and the internal representation.
   * For example, to define a string use "string" as the property, or for example "id string"
   * if the external representation uses 'id' as the key. To define an object as a
   * model member, use the name of the model (ie, 'User'). For a map, use '{}' before the
   * type and for an array use '[]' before the type.
   *
   * @arg {function} classConstructor - The constructor for the model
   * @arg {Object.<string,string>} classProps - The definition of the model properties
   * @arg {string=} className - The name of the class referred to in class properties.
   *   Uses constructor name if not given.
   * @throws Error
   */
  static define(classConstructor, classProps, className) {
    if (typeof classConstructor !== 'function') {
      throw new Error('Called define without a class constructor');
    }
    const classKey = classConstructor.name;
    if (Model.constructors[classKey]) {
      throw new Error(`Class already defined ${className || classKey}`);
    }
    const proto = Model.$newproto(classKey, classProps, className);
    if (!proto) {
      throw new Error(`No prototype for ${className || classKey}`);
    }
    Model.constructors[classKey] = classConstructor;
    Model.models[classKey] = proto;
  }

  /**
   * @method Model#$get
   * @arg {string} key - The key of the property
   * @returns {string|number|boolean|Date|Map|Array|Model|undefined}
   * @desc Return a property value or undefined
   */
  /**
   * @method Model#$set
   * @arg {string} key - The key of the property
   * @arg {string|number|boolean|Date|Map|Array|Model|undefined} value - The value
   *  for the property
   * @returns {string|number|boolean|Date|Map|Array|Model|undefined}
   * @desc Set a property value for a key
   */
  /**
   * @method Model#$getall
   * @returns {Object}
   * @desc Get all property values that can be transmitted stored in external representation.
   *  Does not include values which are undefined.
   */
  /**
   * @method Model#$setall
   * @desc Set all property values from external representation. Replaces all existing
   * property values.
   * @returns {Object}
   */
  /**
   * @method Model#toString
   * @desc Return object in string form, for debugging.
   * @returns {string}
   */
  /**
   * @method Model#$equals
   * @desc Checks for equality between this object and another model.
   * @returns {boolean}
   */
  static $newproto(classKey, classProps, className) {
    const proto = {};

    // Set className alias
    if (className) {
      Model.alias[className] = classKey;
    }

    // $className property
    Object.defineProperty(proto, '$className', {
      value: className || classKey,
      writable: false,
      enumerable: false,
    });

    // $type property
    Model.types[classKey] = new Map();
    Object.defineProperty(proto, '$type', {
      get() {
        return Model.types[classKey];
      },
      enumerable: false,
    });

    // $json property
    Object.defineProperty(proto, '$json', {
      get() {
        return JSON.stringify(this.$getall());
      },
      enumerable: false,
    });

    // Other properties
    Object.entries(classProps).forEach((entry) => {
      const key = entry[0];
      const decl = entry[1];
      // Parse type
      const type = this.$parsetype(key, decl);
      if (!type) {
        throw new Error(`Unable to parse declaration ${decl} for ${key}`);
      } else {
        Model.types[classKey].set(key, type);
      }
      // Create getter and setter
      Object.defineProperty(proto, key, {
        enumerable: true,
        get() {
          return this.$data[key];
        },
        set(value) {
          const v = this.$type.get(key);
          this.$data[key] = Model.$cast(value, v.collection, v.primitive, v.model);
        },
      });
    });

    proto.$get = function (key) {
      return this.$data[key];
    };

    proto.$set = function (key, value) {
      const v = this.$type.get(key);
      this.$data[key] = Model.$cast(value, v.collection, v.primitive, v.model);
      return this.$data[key];
    };

    proto.$getall = function () {
      const obj = {};
      this.$type.forEach((v, k) => {
        const value = Model.$json(this.$data[k]);
        if (value !== undefined) {
          obj[v.alias] = value;
        }
      });
      return obj;
    };

    proto.$setall = function (data) {
      if (typeof data !== 'object') {
        throw new Error(`Constructor requires object for ${this.constructor.name}`);
      }
      this.$data = {};
      this.$type.forEach((v, k) => {
        this.$data[k] = Model.$cast(data[v.alias], v.collection, v.primitive, v.model);
      });
    };

    proto.toString = function () {
      let str = `<${this.$className}`;
      this.$type.forEach((_, k) => {
        const value = Model.$toString(this.$get(k));
        str += ` ${k}=${value}`;
      });
      return `${str}>`;
    };

    proto.$equals = function (other) {
      if (!other) {
        return false;
      }
      if (this.$className !== other.$className) {
        return false;
      }
      return (this.$json === other.$json);
    };

    // Return the prototype
    return proto;
  }

  static $toString(value) {
    if (value === null || value === undefined) {
      return '<nil>';
    }
    if (typeof value === 'string') {
      return value.quote();
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return `${value}`;
    }
    if (typeof value !== 'object') {
      return '[?? unsupported type]';
    }
    if (value instanceof Date) {
      return `<${value.toLocaleString()}>`;
    }
    if (value instanceof Map) {
      let str = '{ ';
      value.forEach((elem, k) => {
        str += `${k}:${this.$toString(elem)} `;
      });
      return `${str}}`;
    }
    if (value instanceof Array) {
      let str = '[ ';
      value.forEach((elem, i) => {
        str += (i === 0 ? '' : ',') + this.$toString(elem);
      });
      return `${str} ]`;
    }
    return `${value}`;
  }

  static $parsetype(key, value) {
    let parts = REGEXP_ALIASED.exec(value);
    if (!parts) {
      parts = REGEXP_NOTALIASED.exec(value);
    }
    if (parts) {
      return {
        alias: parts[1] || key,
        collection: this.$collectiontype(parts[2]),
        primitive: this.$primitivetype(parts[3]),
        model: this.$modeltype(parts[3]),
      };
    }
    return undefined;
  }

  static $collectiontype(value) {
    switch (value) {
      case '{}':
        return Model.primitive.MAP;
      case '[]':
        return Model.primitive.ARRAY;
      default:
        return undefined;
    }
  }

  static $primitivetype(value) {
    switch (value) {
      case Model.primitive.NUMBER:
      case Model.primitive.STRING:
      case Model.primitive.BOOLEAN:
      case Model.primitive.DATE:
        return value;
      default:
        return Model.types.OBJECT;
    }
  }

  static $modeltype(value) {
    switch (value) {
      case Model.primitive.NUMBER:
      case Model.primitive.STRING:
      case Model.primitive.BOOLEAN:
      case Model.primitive.DATE:
        return undefined;
      default:
        return value;
    }
  }

  static $json(value) {
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'object' && value instanceof Date) {
      return value;
    }
    if (typeof value === 'object' && value instanceof Array) {
      const arr = [];
      value.forEach((elem) => {
        arr.push(this.$json(elem));
      });
      return arr;
    }
    if (typeof value === 'object' && value instanceof Map) {
      const map = {};
      value.forEach((elem, key) => {
        map[key] = this.$json(elem);
      });
      return map;
    }
    if (typeof value === 'object' && value.$getall) {
      return value.$getall();
    }
    return undefined;
  }

  static $cast(value, collection, primitive, model) {
    // If undefined then return
    if (value === null || value === undefined) {
      return undefined;
    }

    // Cast collection types
    switch (collection) {
      case Model.primitive.ARRAY:
        return this.$castarray(value, primitive, model);
      case Model.primitive.MAP:
        return this.$castmap(value, primitive, model);
      default:
      // NOOP
    }

    // Cast primitive and object types
    switch (primitive) {
      case Model.primitive.STRING:
        return this.$caststring(value);
      case Model.primitive.NUMBER:
        return this.$castnumber(value);
      case Model.primitive.BOOLEAN:
        return this.$castboolean(value);
      case Model.primitive.DATE:
        return this.$castdate(value);
      default:
        return this.$castobject(value, model);
    }
  }

  static $castarray(value, primitive, model) {
    const arr = [];
    if (Array.isArray(value)) {
      value.forEach((elem) => {
        arr.push(this.$cast(elem, undefined, primitive, model));
      });
      return arr;
    }
    return undefined;
  }

  static $castmap(value, primitive, model) {
    const map = new Map();
    if (typeof value === 'object') {
      Object.entries(value).forEach((entry) => {
        map.set(entry[0], this.$cast(entry[1], undefined, primitive, model));
      });
      return map;
    }
    return undefined;
  }

  static $castobject(value, model) {
    const classKey = Model.alias[model] || model;
    const constructor = Model.constructors[classKey];
    if (constructor) {
      if (value instanceof constructor) {
        return value;
      }
      return new constructor(value);
    }
    throw new Error(`Undefined Model of type ${classKey}`);
  }

  static $castnumber(value) {
    if (typeof value === 'number' || typeof value === 'bigint') {
      return value;
    }
    return parseInt(value, 10);
  }

  static $castdate(value) {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      return new Date(value);
    }
    return undefined;
  }

  static $castboolean(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (`${value}` === 'true') {
      return true;
    }
    if (`${value}` === 'false') {
      return false;
    }
    return undefined;
  }

  static $caststring(value) {
    if (typeof value === 'string') {
      return value;
    }
    if (value) {
      return `${value}`;
    }
    return undefined;
  }
}

// ////////////////////////////////////////////////////////////////////////////
// GLOBALS

Model.constructors = {};
Model.alias = {};
Model.models = {};
Model.types = {};
Model.primitive = Object.freeze({
  NUMBER: 'number',
  STRING: 'string',
  BOOLEAN: 'boolean',
  DATE: 'date',
  OBJECT: 'object',
  ARRAY: 'array',
  MAP: 'map',
});
