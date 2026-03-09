/**
 * jQuery Searchable DropDown Plugin
 *
 * @required jQuery 3.7 or above (compatible with jQuery 4.x)
 * @author Sascha Woo <xhaggi@users.sourceforge.net>
 * Original: $Id: jquery.searchabledropdown.js 53 2012-11-22 08:48:14Z xhaggi $
 * Modernized: 2026-03-09 - jQuery 3.7/4.x compatibility update
 *
 * Copyright (c) 2012 xhaggi
 * https://sourceforge.net/projects/jsearchdropdown/
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Changelog from 1.0.8:
 *  - Removed all $.browser usage (removed in jQuery 1.9); dropped MSIE,
 *    Opera, legacy Safari/Chrome, and Mozilla-specific CSS branches
 *  - Replaced all shorthand event binders (.click(), .blur(), etc.) with
 *    .on() - shorthand binders were removed in jQuery 4.0
 *  - Replaced $.trim() with native String.prototype.trim() (removed in jQuery 4.0)
 *  - Replaced :first pseudo-selector with .children().first() (removed in jQuery 4.0)
 *  - Replaced this.size() with this.length (removed in jQuery 3.0)
 *  - Fixed $.extend() mutating plugin.defaults across calls
 *  - Fixed searching(): search string now preserved separately before being
 *    overwritten by the RegExp object; RegExp flags arg changed from null to ""
 *  - Fixed undefined `options` variable reference in $.meta branch
 *  - Replaced .attr("disabled", ...) / .attr("disabled") with .prop()
 *  - Replaced new Array() with [] literals
 *  - Replaced new Number() wrapper object with a plain numeric primitive
 *  - Replaced "lang" attribute (a real HTML attribute) with data-sdd-idx
 *  - Replaced jQuery.inArray() with native Array.prototype.indexOf()
 *  - Removed trailing semicolons from function declarations
 *  - Removed dead $.meta plugin branch
 */
(function ($) {

	// register plugin
	var plugin = register("searchable");

	// defaults
	plugin.defaults = {
		maxListSize: 100,
		maxMultiMatch: 50,
		exactMatch: false,
		wildcards: true,
		ignoreCase: true,
		warnMultiMatch: "top {0} matches ...",
		warnNoMatch: "no matches ...",
		latency: 200,
		zIndex: "auto"
	};

	/**
	 * Execute function
	 * element-specific code here
	 * @param {Object} settings Settings
	 * @param {number} zindex Stacking z-index for this instance
	 */
	plugin.execute = function (settings, zindex) {

		var timer = null;
		var searchCache = null;
		var search = null;

		// only activate on single-row SELECT elements
		if (this.nodeName !== "SELECT" || this.size > 1) {
			return this;
		}

		var self = $(this);
		var storage = { index: -1, options: null }; // holds data for restoring

		// data attribute used to store the original option index on cloned <option> nodes
		var idxAttr = "data-sdd-idx";

		var enabled = false;

		// objects
		var wrapper  = $("<div/>");
		var overlay  = $("<div/>");
		var input    = $("<input/>");
		var selector = $("<select/>");

		// matching option items
		var topMatchItem = $("<option>" + settings.warnMultiMatch.replace(/\{0\}/g, settings.maxMultiMatch) + "</option>").prop("disabled", true);
		var noMatchItem  = $("<option>" + settings.warnNoMatch + "</option>").prop("disabled", true);

		var selectorHelper = {
			/**
			 * Return DOM option of selector element at idx
			 * @param {number} idx
			 */
			option: function (idx) {
				return $(selector.get(0).options[idx]);
			},
			/**
			 * Returns the currently selected option of the selector element
			 */
			selected: function () {
				return selector.find(":selected");
			},
			/**
			 * Get or set the selectedIndex of the selector element
			 * @param {number} [idx] SelectedIndex; omit to read current value
			 */
			selectedIndex: function (idx) {
				if (idx > -1) {
					selector.get(0).selectedIndex = idx;
				}
				return selector.get(0).selectedIndex;
			},
			/**
			 * Resize the selector to show between 2 and 20 rows
			 * @param {number} size
			 */
			size: function (size) {
				selector.attr("size", Math.max(2, Math.min(size, 20)));
			},
			/**
			 * Reset the selector entries to an initial window around the
			 * currently selected option, bounded by maxMultiMatch
			 */
			reset: function () {
				// return if selector already reflects the stored index
				if ((self.get(0).selectedIndex - 1) === self.data("index")) {
					return;
				}

				// calc start and length of iteration
				var idx   = self.get(0).selectedIndex;
				var len   = self.get(0).length;
				var mc    = Math.floor(settings.maxMultiMatch / 2);
				var begin = Math.max(1, (idx - mc));
				var end   = Math.min(len, Math.max(settings.maxMultiMatch, (idx + mc)));
				var si    = idx - begin;

				// clear selector
				selector.empty();
				this.size(end - begin);

				// append options
				for (var i = begin; i < end; i++) {
					selector.append($(self.get(0).options[i]).clone().attr(idxAttr, i - 1));
				}

				// append top match item if length exceeds maxMultiMatch
				if (end > settings.maxMultiMatch) {
					selector.append(topMatchItem);
				}

				// set selectedIndex of selector
				selector.get(0).selectedIndex = si;
			}
		};

		// draw it
		draw();

		/*
		* EVENT HANDLING
		*/
		var suspendBlur = false;

		overlay.on("mouseover", function () {
			suspendBlur = true;
		});
		overlay.on("mouseout", function () {
			suspendBlur = false;
		});
		selector.on("mouseover", function () {
			suspendBlur = true;
		});
		selector.on("mouseout", function () {
			suspendBlur = false;
		});

		input.on("click", function (e) {
			if (!enabled) {
				enable(e, true);
			} else {
				disable(e, true);
			}
		});

		input.on("blur", function (e) {
			if (!suspendBlur && enabled) {
				disable(e, true);
			}
		});

		self.on("keydown", function (e) {
			if (e.keyCode !== 9 && !e.shiftKey && !e.ctrlKey && !e.altKey) {
				input.trigger("click");
			}
		});

		self.on("click", function () {
			selector.trigger("focus");
		});

		selector.on("click", function (e) {
			if (selectorHelper.selectedIndex() < 0) {
				return;
			}
			disable(e);
		});

		selector.on("focus", function () {
			input.trigger("focus");
		});

		selector.on("blur", function (e) {
			if (!suspendBlur) {
				disable(e, true);
			}
		});

		selector.on("mousemove", function (e) {
			// get font-size of first option
			var fs = Math.floor(parseFloat(/([0-9.]+)px/.exec(selectorHelper.option(0).css("font-size"))));
			// standard line-height ratio for modern browsers
			fs += Math.round(fs / 4);
			// set selectedIndex based on mouse position and line height
			selectorHelper.selectedIndex(Math.floor((e.pageY - selector.offset().top + this.scrollTop) / fs));
		});

		// toggle click event on overlay div
		overlay.on("click", function (e) {
			input.trigger("click");
		});

		// trigger search on keyup
		input.on("keyup", function (e) {
			// break searching while using navigation/modifier keys
			var navKeys = [9, 13, 16, 33, 34, 35, 36, 38, 40];
			if (navKeys.indexOf(e.keyCode) > -1) {
				return true;
			}

			// set search text
			search = input.val().toLowerCase().trim();

			// if a previous timer is running, stop it
			clearSearchTimer();

			// start new timer
			timer = setTimeout(searching, settings.latency);
		});

		// handle keyboard navigation within the dropdown
		input.on("keydown", function (e) {

			// tab stop
			if (e.keyCode === 9) {
				disable(e);
			}

			// return on shift, ctrl, alt key mode
			if (e.shiftKey || e.ctrlKey || e.altKey) {
				return;
			}

			switch (e.keyCode) {
				case 13: // enter
					disable(e);
					self.trigger("focus");
					break;
				case 27: // escape
					disable(e, true);
					self.trigger("focus");
					break;
				case 33: // page up
					if (selectorHelper.selectedIndex() - selector.attr("size") > 0) {
						selectorHelper.selectedIndex(selectorHelper.selectedIndex() - selector.attr("size"));
					} else {
						selectorHelper.selectedIndex(0);
					}
					synchronize();
					break;
				case 34: // page down
					if (selectorHelper.selectedIndex() + selector.attr("size") < selector.get(0).options.length - 1) {
						selectorHelper.selectedIndex(selectorHelper.selectedIndex() + selector.attr("size"));
					} else {
						selectorHelper.selectedIndex(selector.get(0).options.length - 1);
					}
					synchronize();
					break;
				case 38: // up
					if (selectorHelper.selectedIndex() > 0) {
						selectorHelper.selectedIndex(selectorHelper.selectedIndex() - 1);
						synchronize();
					}
					break;
				case 40: // down
					if (selectorHelper.selectedIndex() < selector.get(0).options.length - 1) {
						selectorHelper.selectedIndex(selectorHelper.selectedIndex() + 1);
						synchronize();
					}
					break;
				default:
					return true;
			}

			// key was handled - stop propagation
			return false;
		});

		/**
		 * Draw the needed elements
		 */
		function draw() {

			// fix some styles on the source select
			self.css("text-decoration", "none");
			self.width(self.outerWidth());
			self.height(self.outerHeight());

			// wrapper styles
			wrapper.css({
				"position": "relative",
				"width": self.outerWidth()
			});

			// overlay div to block pointer events on the source select element
			overlay.css({
				"position":         "absolute",
				"top":              0,
				"left":             0,
				"width":            self.outerWidth(),
				"height":           self.outerHeight(),
				"background-color": "#FFFFFF",
				"opacity":          "0.01"
			});

			// search text field
			input.attr("type", "text");
			input.hide();
			input.height(self.innerHeight());

			// base styles for the text field
			input.css({
				"position":            "absolute",
				"top":                 0,
				"left":                0,
				"margin":              "0px",
				"padding":             "0px",
				"outline-style":       "none",
				"border-style":        "solid",
				"border-bottom-style": "none",
				"border-color":        "transparent",
				"background-color":    "transparent"
			});

			// copy relevant styles from source select to text field
			var inheritedStyles = [
				"border-left-width",
				"border-top-width",
				"font-size",
				"font-stretch",
				"font-variant",
				"font-weight",
				"color",
				"text-align",
				"text-indent",
				"text-shadow",
				"text-transform",
				"padding-left",
				"padding-top"
			];
			for (var i = 0; i < inheritedStyles.length; i++) {
				input.css(inheritedStyles[i], self.css(inheritedStyles[i]));
			}

			// modern baseline padding adjustments (replaces all legacy browser branches)
			input.css("padding-left", parseFloatPx(self.css("padding-left")) + 3);
			input.css("padding-top",  parseFloatPx(self.css("padding-top"))  + 1);

			// adjust width of search field
			var offset = parseFloatPx(self.css("padding-left"))      +
						parseFloatPx(self.css("padding-right"))      +
						parseFloatPx(self.css("border-left-width"))  +
						parseFloatPx(self.css("border-right-width")) + 23;
			input.width(self.outerWidth() - offset);

			// store css width then temporarily set to auto to measure the
			// natural width needed to fit the longest option entry
			var w  = self.css("width");
			var ow = self.outerWidth();
			self.css("width", "auto");
			ow = ow > self.outerWidth() ? ow : self.outerWidth();
			self.css("width", w);

			// entries selector replacement
			selector.hide();
			selectorHelper.size(self.get(0).length);
			selector.css({
				"position":         "absolute",
				"top":              self.outerHeight(),
				"left":             0,
				"width":            ow,
				"border":           "1px solid #333",
				"font-weight":      "normal",
				"padding":          0,
				"background-color": self.css("background-color"),
				"text-transform":   self.css("text-transform")
			});

			// z-index handling
			var zIndex = /^\d+$/.test(self.css("z-index")) ? parseInt(self.css("z-index"), 10) : 1;
			if (settings.zIndex && /^\d+$/.test(settings.zIndex)) {
				zIndex = parseInt(settings.zIndex, 10);
			}
			overlay.css("z-index",  zIndex);
			input.css("z-index",    zIndex + 1);
			selector.css("z-index", zIndex + 2);

			// append to container
			self.wrap(wrapper);
			self.after(overlay);
			self.after(input);
			self.after(selector);
		}

		/**
		 * Enable the search facilities
		 *
		 * @param {Object}  e Event
		 * @param {boolean} s Show selector
		 * @param {boolean} v Verbose enabling
		 */
		function enable(e, s, v) {

			// exit if the source select element is disabled
			if (self.prop("disabled")) {
				return false;
			}

			// prepend empty option
			self.prepend("<option />");

			// toggle enabled state (unless v suppresses it)
			if (typeof v === "undefined") {
				enabled = !enabled;
			}

			// reset selector
			selectorHelper.reset();

			// synchronize select and dropdown replacement
			synchronize();

			// store search result
			store();

			// show selector
			if (s) {
				selector.show();
			}

			// show search field
			input.show();
			input.trigger("focus");
			input.trigger("select");

			// select empty option
			self.get(0).selectedIndex = 0;

			if (typeof e !== "undefined") {
				e.stopPropagation();
			}
		}

		/**
		 * Disable the search facilities
		 *
		 * @param {Object}  e  Event
		 * @param {boolean} rs Restore last results
		 */
		function disable(e, rs) {

			// set state to disabled
			enabled = false;

			// remove empty option (the sentinel prepended by enable())
			self.children("option").first().remove();

			// clear running search timer
			clearSearchTimer();

			// hide search field and selector
			input.hide();
			selector.hide();

			// restore last results if requested
			if (typeof rs !== "undefined") {
				restore();
			}

			// populate changes
			populate();

			if (typeof e !== "undefined") {
				e.stopPropagation();
			}
		}

		/**
		 * Clears a running search timer
		 */
		function clearSearchTimer() {
			if (timer !== null) {
				clearTimeout(timer);
			}
		}

		/**
		 * Populate the source select element with the currently chosen option
		 */
		function populate() {
			// skip if nothing selected or the selected option is disabled
			if (selectorHelper.selectedIndex() < 0 || selectorHelper.selected().get(0).disabled) {
				return;
			}

			// store selectedIndex on the source element
			self.get(0).selectedIndex = parseInt(selector.find(":selected").attr(idxAttr), 10);

			// trigger change event
			self.trigger("change");

			// cache the selected index for future comparison
			self.data("index", self.get(0).selectedIndex);
		}

		/**
		 * Synchronize the text in the search input with the currently selected option
		 */
		function synchronize() {
			if (selectorHelper.selectedIndex() > -1 && !selectorHelper.selected().get(0).disabled) {
				input.val(selector.find(":selected").text());
			} else {
				input.val(self.find(":selected").text());
			}
		}

		/**
		 * Store the current selector state so it can be restored later
		 */
		function store() {
			storage.index   = selectorHelper.selectedIndex();
			storage.options = [];
			for (var i = 0; i < selector.get(0).options.length; i++) {
				storage.options.push(selector.get(0).options[i]);
			}
		}

		/**
		 * Restore the selector state previously saved by store()
		 */
		function restore() {
			selector.empty();
			for (var i = 0; i < storage.options.length; i++) {
				selector.append(storage.options[i]);
			}
			selectorHelper.selectedIndex(storage.index);
			selectorHelper.size(storage.options.length);
		}

		/**
		 * Escape special regular expression characters in a string
		 *
		 * @param  {string} str
		 * @return {string} escaped regexp string
		 */
		function escapeRegExp(str) {
			var specials = ["/", ".", "*", "+", "?", "|", "(", ")", "[", "]", "{", "}", "\\", "^", "$"];
			var regexp   = new RegExp("(\\" + specials.join("|\\") + ")", "g");
			return str.replace(regexp, "\\$1");
		}

		/**
		 * The actual searching gets done here
		 */
		function searching() {
			if (searchCache === search) { // no change - skip
				timer = null;
				return;
			}

			var matches     = 0;
			var searchStr   = search; // preserve the raw string before we overwrite search with a RegExp
			searchCache     = search;

			selector.hide();
			selector.empty();

			// escape regexp characters from the raw string
			var regexp = escapeRegExp(searchStr);

			// exact match anchor
			if (settings.exactMatch) {
				regexp = "^" + regexp;
			}
			// wildcard support
			if (settings.wildcards) {
				regexp = regexp.replace(/\\\*/g, ".*");
				regexp = regexp.replace(/\\\?/g, ".");
			}

			// build RegExp - use "" instead of null when case-sensitive so the
			// RegExp constructor receives a valid flags argument in all engines
			var flags    = settings.ignoreCase ? "i" : "";
			var searchRe = new RegExp(regexp, flags);

			// iterate source options (index 1+ to skip the sentinel empty option)
			for (var i = 1; i < self.get(0).length && matches < settings.maxMultiMatch; i++) {
				if (searchStr.length === 0 || searchRe.test(self.get(0).options[i].text)) {
					var opt = $(self.get(0).options[i]).clone().attr(idxAttr, i - 1);
					if (self.data("index") === i) {
						opt.text(self.data("text"));
					}
					selector.append(opt);
					matches++;
				}
			}

			// result actions
			if (matches >= 1) {
				selectorHelper.selectedIndex(0);
			} else if (matches === 0) {
				selector.append(noMatchItem);
			}

			// append top-match notice if results were capped
			if (matches >= settings.maxMultiMatch) {
				selector.append(topMatchItem);
			}

			// resize and reveal
			selectorHelper.size(matches);
			selector.show();
			timer = null;
		}

		/**
		 * Parse a CSS pixel value string to a float
		 * @param  {string} value  e.g. "12.5px"
		 * @return {number}
		 */
		function parseFloatPx(value) {
			try {
				var n = parseFloat(value.replace(/[\s]*px/, ""));
				if (!isNaN(n)) {
					return n;
				}
			} catch (e) {}
			return 0;
		}
	};

	/**
	 * Register the plugin under a given namespace on the jQuery object.
	 *
	 * @param  {string} nsp  Namespace for the plugin (e.g. "searchable")
	 * @return {Object}      Plugin object
	 */
	function register(nsp) {

		// init plugin namespace
		var plugin = $[nsp] = {};

		// bind function to jQuery.fn
		$.fn[nsp] = function (settings) {
			// extend a fresh copy of defaults - never mutate plugin.defaults
			settings = $.extend({}, plugin.defaults, settings);

			var elmSize = this.length;
			return this.each(function (index) {
				plugin.execute.call(this, settings, elmSize - index);
			});
		};

		return plugin;
	}

})(jQuery);
