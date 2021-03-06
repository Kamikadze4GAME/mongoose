'use strict';

const Document = require('../document');
const immediate = require('../helpers/immediate');
const internalToObjectOptions = require('../options').internalToObjectOptions;
const promiseOrCallback = require('../helpers/promiseOrCallback');

const documentArrayParent = require('../helpers/symbols').documentArrayParent;

module.exports = Subdocument;

/**
 * Subdocument constructor.
 *
 * @inherits Document
 * @api private
 */

function Subdocument(value, fields, parent, skipId, options) {
  this.$isSingleNested = true;
  if (options != null && options.path != null) {
    this.$basePath = options.path;
  }
  const hasPriorDoc = options != null && options.priorDoc;
  let initedPaths = null;
  if (hasPriorDoc) {
    this._doc = Object.assign({}, options.priorDoc._doc);
    delete this._doc[this.schema.options.discriminatorKey];
    initedPaths = Object.keys(options.priorDoc._doc || {}).
      filter(key => key !== this.schema.options.discriminatorKey);
  }
  if (parent != null) {
    // If setting a nested path, should copy isNew from parent re: gh-7048
    options = Object.assign({}, options, {
      isNew: parent.isNew,
      defaults: parent.$__.$options.defaults
    });
  }
  Document.call(this, value, fields, skipId, options);

  if (hasPriorDoc) {
    for (const key of initedPaths) {
      if (!this.$__.activePaths.states.modify[key] &&
          !this.$__.activePaths.states.default[key] &&
          !this.$__.$setCalled.has(key)) {
        const schematype = this.schema.path(key);
        const def = schematype == null ? void 0 : schematype.getDefault(this);
        if (def === void 0) {
          delete this._doc[key];
        } else {
          this._doc[key] = def;
          this.$__.activePaths.default(key);
        }
      }
    }

    delete options.priorDoc;
    delete this.$__.$options.priorDoc;
  }
}

Subdocument.prototype = Object.create(Document.prototype);

Subdocument.prototype.toBSON = function() {
  return this.toObject(internalToObjectOptions);
};

/**
 * Used as a stub for middleware
 *
 * ####NOTE:
 *
 * _This is a no-op. Does not actually save the doc to the db._
 *
 * @param {Function} [fn]
 * @return {Promise} resolved Promise
 * @api private
 */

Subdocument.prototype.save = function(options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  options = options || {};

  if (!options.suppressWarning) {
    console.warn('mongoose: calling `save()` on a subdoc does **not** save ' +
      'the document to MongoDB, it only runs save middleware. ' +
      'Use `subdoc.save({ suppressWarning: true })` to hide this warning ' +
      'if you\'re sure this behavior is right for your app.');
  }

  return promiseOrCallback(fn, cb => {
    this.$__save(cb);
  });
};

/**
 * Used as a stub for middleware
 *
 * ####NOTE:
 *
 * _This is a no-op. Does not actually save the doc to the db._
 *
 * @param {Function} [fn]
 * @method $__save
 * @api private
 */

Subdocument.prototype.$__save = function(fn) {
  return immediate(() => fn(null, this));
};

Subdocument.prototype.$isValid = function(path) {
  if (this.$__parent && this.$basePath) {
    return this.$__parent.$isValid([this.$basePath, path].join('.'));
  }
  return Document.prototype.$isValid.call(this, path);
};

Subdocument.prototype.markModified = function(path) {
  Document.prototype.markModified.call(this, path);

  if (this.$__parent && this.$basePath) {
    if (this.$__parent.isDirectModified(this.$basePath)) {
      return;
    }
    this.$__parent.markModified([this.$basePath, path].join('.'), this);
  }
};

Subdocument.prototype.isModified = function(paths, modifiedPaths) {
  if (this.$__parent && this.$basePath) {
    if (Array.isArray(paths) || typeof paths === 'string') {
      paths = (Array.isArray(paths) ? paths : paths.split(' '));
      paths = paths.map(p => [this.$basePath, p].join('.'));

      return this.$__parent.isModified(paths, modifiedPaths);
    }

    return this.$__parent.isModified(this.$basePath);
  }

  return Document.prototype.isModified.call(this, paths, modifiedPaths);
};

/**
 * Marks a path as valid, removing existing validation errors.
 *
 * @param {String} path the field to mark as valid
 * @api private
 * @method $markValid
 * @receiver Subdocument
 */

Subdocument.prototype.$markValid = function(path) {
  Document.prototype.$markValid.call(this, path);
  if (this.$__parent && this.$basePath) {
    this.$__parent.$markValid([this.$basePath, path].join('.'));
  }
};

/*!
 * ignore
 */

Subdocument.prototype.invalidate = function(path, err, val) {
  // Hack: array subdocuments' validationError is equal to the owner doc's,
  // so validating an array subdoc gives the top-level doc back. Temporary
  // workaround for #5208 so we don't have circular errors.
  if (err !== this.ownerDocument().$__.validationError) {
    Document.prototype.invalidate.call(this, path, err, val);
  }

  if (this.$__parent && this.$basePath) {
    this.$__parent.invalidate([this.$basePath, path].join('.'), err, val);
  } else if (err.kind === 'cast' || err.name === 'CastError') {
    throw err;
  }

  return this.ownerDocument().$__.validationError;
};

/*!
 * ignore
 */

Subdocument.prototype.$ignore = function(path) {
  Document.prototype.$ignore.call(this, path);
  if (this.$__parent && this.$basePath) {
    this.$__parent.$ignore([this.$basePath, path].join('.'));
  }
};

/**
 * Returns the top level document of this sub-document.
 *
 * @return {Document}
 */

Subdocument.prototype.ownerDocument = function() {
  if (this.$__.ownerDocument) {
    return this.$__.ownerDocument;
  }

  let parent = this.$__parent;
  if (!parent) {
    return this;
  }

  while (parent.$__parent || parent[documentArrayParent]) {
    parent = parent.$__parent || parent[documentArrayParent];
  }

  this.$__.ownerDocument = parent;
  return this.$__.ownerDocument;
};

/**
 * Returns this sub-documents parent document.
 *
 * @api public
 */

Subdocument.prototype.parent = function() {
  return this.$__parent;
};

/**
 * Returns this sub-documents parent document.
 *
 * @api public
 */

Subdocument.prototype.$parent = Subdocument.prototype.parent;

/*!
 * no-op for hooks
 */

Subdocument.prototype.$__remove = function(cb) {
  return cb(null, this);
};

/**
 * Null-out this subdoc
 *
 * @param {Object} [options]
 * @param {Function} [callback] optional callback for compatibility with Document.prototype.remove
 */

Subdocument.prototype.remove = function(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }

  registerRemoveListener(this);

  // If removing entire doc, no need to remove subdoc
  if (!options || !options.noop) {
    this.$__parent.set(this.$basePath, null);
  }

  if (typeof callback === 'function') {
    callback(null);
  }
};

/*!
 * ignore
 */

Subdocument.prototype.populate = function() {
  throw new Error('Mongoose does not support calling populate() on nested ' +
    'docs. Instead of `doc.nested.populate("path")`, use ' +
    '`doc.populate("nested.path")`');
};

/*!
 * Registers remove event listeners for triggering
 * on subdocuments.
 *
 * @param {Subdocument} sub
 * @api private
 */

function registerRemoveListener(sub) {
  let owner = sub.ownerDocument();

  function emitRemove() {
    owner.removeListener('save', emitRemove);
    owner.removeListener('remove', emitRemove);
    sub.emit('remove', sub);
    sub.constructor.emit('remove', sub);
    owner = sub = null;
  }

  owner.on('save', emitRemove);
  owner.on('remove', emitRemove);
}
