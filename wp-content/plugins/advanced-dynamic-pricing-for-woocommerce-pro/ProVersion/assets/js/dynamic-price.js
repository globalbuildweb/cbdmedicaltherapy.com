/**
 * @property {object} wdp_script_data_pro
 * @property {string} wdp_script_data_pro.ajaxurl
 * @property {string} wdp_script_data_pro.update_price_with_qty
 * @property {string} wdp_script_data_pro.js_init_trigger
 * @property {boolean} wdp_script_data_pro.replace_variable_price
 * @property {string} wdp_script_data_pro.variable_price_selector
 * @property {object} wdp_script_data_pro.page_data
 * @property {boolean} wdp_script_data_pro.create_on_load
 */

/**
 * @class
 */
var DynamicPrice = (function () {
    /**
     * @constructs DynamicPrice
     * @param {jQuery} $form
     * @param {object} $opts
     */
    function DynamicPrice($form, $opts) {
        /**
         * @type {Boolean}
         * @private
         */
        this.__isEnable = false;

        /**
         * @type {Object}
         * @private
         */
        this.__pageData = {};

        /**
         * @type {String}
         * @private
         */
        this.__ajaxUrl = "";

        /**
         * @name DynamicPrice#form
         * @type {jQuery}
         */
        this.form = null;

        /**
         * @type {number}
         * @private
         */
        this.__inputTimerId = null;

        /**
         * @type {Array}
         * @private
         */
        this.__price_destinations = [];

        /**
         * @type {Array}
         * @private
         */
        this.__subtotal_destinations = [];

        this.__priceHtmlTemplate = "{{price_html}}";

        this.__priceSuffix = "";

        // for input observing
        this.__lastChange = null;
        this.__lastValue = null;

        if (typeof $opts === 'undefined') {
            $opts = wdp_script_data_pro;
        }

        if (typeof $opts.price_html_template !== 'undefined') {
            this.__priceHtmlTemplate = $opts.price_html_template;
        }

        if (typeof $opts.update_price_with_qty !== 'undefined') {
            this.__isEnable = $opts.update_price_with_qty === "1";
        }
        if (typeof $opts.page_data !== 'undefined') {
            this.__pageData = $opts.page_data;
        }

        if (typeof $opts.price_suffix !== 'undefined') {
            this.__priceSuffix = $opts.price_suffix;
        }

        if (typeof $opts.ajaxurl !== 'undefined') {
            this.__ajaxUrl = $opts.ajaxurl;
        } else {
            logError("Empty ajaxurl");
            return;
        }

        if (typeof $form !== 'undefined' && $form.is('form')) {
            this.form = $form
        } else {
            logError("Incorrect form provided");
        }
    }

    function getTimestamp() {
        return Math.floor(Date.now() / 1000);
    }

    DynamicPrice.prototype.stopObserve = function () {
        if (this.__inputTimerId) {
            clearInterval(this.__inputTimerId);
        }
    };

    DynamicPrice.prototype.__getQty = function () {
        var $input = this.form.find('input[name="quantity"]');
        if ($input.length === 0) {
            return 0;
        }

        return $input.val();
    };

    DynamicPrice.prototype.observe = function () {
        this.stopObserve();

        this.__lastChange = null;
        this.__lastValue = this.__getQty();

        this.__inputTimerId = setInterval(this.__watch.bind(this), 300);
    };

    DynamicPrice.prototype.__watch = function () {
        var $qty = this.__getQty();

        if ($qty && this.__lastValue !== $qty) {
            this.__lastValue = $qty;
            this.__lastChange = getTimestamp();
        } else if (this.__lastValue && this.__lastValue === $qty && this.__lastChange) {
            this.__lastChange = null;
            this.__update(this.__lastValue);
        }
    };

    DynamicPrice.prototype.__getProductId = function () {
        var variationIdEl = this.form.find('[name="variation_id"]');
        var productIdEl = this.form.find('[name="add-to-cart"]');

        if (variationIdEl.length) {
            return parseInt(variationIdEl.val());
        } else if (productIdEl.length) {
            return parseInt(productIdEl.val());
        }

        return false;
    };

    DynamicPrice.prototype.__update = function ($qty, $customPrice) {
        if (!this.__isEnable) {
            return;
        }

        if (typeof $qty === 'undefined' || !$qty) {
            logError("Empty qty");
            return;
        } else {
            $qty = parseFloat($qty);
        }

        if (typeof $customPrice === 'undefined') {
            $customPrice = null;
        }

        var $productId = this.__getProductId();
        if (!$productId) {
            logError("Empty product ID");
            return;
        }

        var $existPriceDestinations = [];
        jQuery.each(this.__price_destinations, function (_, $selector) {
            var $el = jQuery($selector).first();
            if ($el.length !== 0) {
                $existPriceDestinations.push($el);
            }
        });

        var $existSubtotalDestinations = [];
        jQuery.each(this.__subtotal_destinations, function (_, $selector) {
            var $el = jQuery($selector).first();
            if ($el.length !== 0) {
                $existSubtotalDestinations.push($el);
            }
        });

        if ($existPriceDestinations.length === 0 && $existSubtotalDestinations.length === 0) {
            logError("Empty destinations before update");
            return;
        }

        var data = {
            action: 'get_price_product_with_bulk_table',
            product_id: $productId,
            qty: $qty,
            page_data: this.__pageData
        };

        var $spinner_price = "<div id=\"spinner_price\"><img class=\"spinner_img\"></div>";

        if ($customPrice !== null) {
            data.custom_price = $customPrice;
        } else {
            var $price_html = this.__tryToGetPreLoadedPrice($productId, $qty);
            if ($price_html) {
                replaceDestinations($existPriceDestinations, $price_html);
                return;
            }
        }

        replaceDestinations($existPriceDestinations, $spinner_price);
        replaceDestinations($existSubtotalDestinations, $spinner_price);

        return jQuery.ajax({
            url: this.__ajaxUrl,
            data: data,
            dataType: 'json',
            type: 'POST',
            success: function (response) {
                if (response.success) {
                    replaceDestinations($existPriceDestinations, response.data.price_html);
                    replaceDestinations($existSubtotalDestinations, response.data.subtotal_html);
                } else {
                    clearDestinations($existPriceDestinations);
                    clearDestinations($existSubtotalDestinations);
                }
            },
            error: function (response) {
                clearDestinations($existPriceDestinations);
                clearDestinations($existSubtotalDestinations);
            }
        });
    };

    DynamicPrice.prototype.__tryToGetPreLoadedPrice = function ($productId, $qty) {
        if ( typeof wdp_script_data_pro.preLoaded === 'undefined' ) {
            return null;
        }

        var $preLoaded = wdp_script_data_pro.preLoaded;

        $qty = parseFloat($qty);
        if ( ! $qty ) {
            return null;
        }

        $productId = $productId.toString();

        var _this = this;

        var $html = null;
        jQuery.each($preLoaded, function ($preLoadedProductId, $data) {
            if ( typeof $data.ranges === 'undefined' || typeof $data.price_html === 'undefined' || typeof $data.index_number === 'undefined' ) {
                return; // continue
            }
            var $ranges = $data.ranges;
            var $price_html = $data.price_html;
            var $current_qty = $data.index_number + $qty;
            var $qty_already_in_cart = $data.qty_already_in_cart;

            if ( $preLoadedProductId === $productId ) {
                jQuery.each($ranges, function (_, $range) {
                    if (compareFloats($range['from'], '<=', $current_qty) && compareFloats($current_qty, '<=', $range['to'])
                        || (compareFloats($range['from'], '<=', $current_qty) && $range['to'] === "")
                        || ($range['from'] === "" && compareFloats($current_qty, '<=', $range['to']))
                    ) {
                        $html = _this.__formatPriceHtml($range['striked_price_html'], $current_qty, $qty_already_in_cart);
                        return false;
                    }
                });

                if ( ! $html ) {
                    $html = _this.__formatPriceHtml($price_html, $current_qty, $qty_already_in_cart);
                }
            }
            if ( $html ) {
                return false;
            }
        });

        return $html;
    };

    function compareFloats($a, $op, $b) {
        $a = Math.floor(parseFloat($a) * 100);
        $b = Math.floor(parseFloat($b) * 100);

        switch ($op) {
            case "=":
                return $a === $b;
            case ">":
                return $a > $b;
            case ">=":
                return $a >= $b;
            case "<":
                return $a < $b;
            case "<=":
                return $a <= $b;
        }

        return null;
    }

    function replaceDestinations($targets, $priceHtml) {
        jQuery.each($targets, function (_, $target) {
            $target.html($priceHtml);
            jQuery(document).trigger('wdp_price_product_updated', $priceHtml);
        })
    }

    function clearDestinations($targets) {
        jQuery.each($targets, function (_, $target) {
            $target.html("");
            jQuery(document).trigger('wdp_price_product_updated', "");
        })
    }

    DynamicPrice.prototype.addPriceDestination = function ($dest) {
        if (typeof $dest === 'string') {
            this.__price_destinations.push($dest);
        } else if (Array.isArray($dest)) {
            Array.prototype.push.apply(this.__price_destinations, $dest);
        }
    };

    DynamicPrice.prototype.addSubtotalDestination = function ($dest) {
        if (typeof $dest === 'string') {
            this.__subtotal_destinations.push($dest);
        } else if (Array.isArray($dest)) {
            Array.prototype.push.apply(this.__subtotal_destinations, $dest);
        }
    };

    DynamicPrice.prototype.update = function ($args) {
        var $qty = null;
        var $customPrice = null;

        if (typeof $args !== 'undefined') {
            if (typeof $args.qty !== 'undefined') {
                $qty = parseFloat($args.qty);
            } else {
                $qty = this.__getQty();
            }

            if (typeof $args.custom_price !== 'undefined') {
                $customPrice = $args.custom_price;
            }
        }

        return this.__update($qty, $customPrice);
    };


    DynamicPrice.prototype.disable = function () {
        this.__isEnable = false;
    };

    DynamicPrice.prototype.enable = function () {
        this.__isEnable = true;
    };

    DynamicPrice.prototype.__formatPriceHtml = function ($priceHtml, $indexNumber, $qtyAlreadyInCart) {
        return this.__priceHtmlTemplate
            .replace("{{price_html}}", $priceHtml)
            .replace("{{Nth_item}}", addSuffixOf($indexNumber))
            .replace("{{qty_already_in_cart}}", $qtyAlreadyInCart)
            .replace("{{price_suffix}}", this.__priceSuffix);
    };

    function addSuffixOf($value) {
        var mod10 = $value % 10,
            mod100 = $value % 100;

        if (mod10 === 1 && mod100 !== 11) {
            return $value + "st";
        }
        if (mod10 === 2 && mod100 !== 12) {
            return $value + "nd";
        }
        if (mod10 === 3 && mod100 !== 13) {
            return $value + "rd";
        }
        return $value + "th";
    }

    function logError($text) {
        console.error("DynamicPrice error: %s", $text);
    }

    return DynamicPrice;
})();

var dynamicPrices = [];

function createDynamicPrice() {
    var dynamicPrices = [];

    jQuery('form.cart').each(function () {
        var $form = jQuery(this);
        var isVariation = $form.hasClass("variations_form");
        var $targets = [];
        var $productId = $form.find('[name="add-to-cart"]').val();

        if (!$productId) {
            return false;
        }

        if (isVariation) {
            $targets.push('div.product.post-' + $productId + ' .woocommerce-variation-price');

            if (wdp_script_data_pro.replace_variable_price) {
                $targets.push('div.product.post-' + $productId + ' ' + wdp_script_data_pro.variable_price_selector);
            }
        } else {
            $targets.push('div.product.post-' + $productId + ' .price');
        }

        var dynamicPrice = new DynamicPrice($form);
        dynamicPrice.addPriceDestination($targets);
        dynamicPrice.observe();
        dynamicPrices.push(dynamicPrice);
    });

    return dynamicPrices;
}

if (wdp_script_data_pro.js_init_trigger) {
    jQuery(document).on(wdp_script_data_pro.js_init_trigger, function () {
        dynamicPrices = createDynamicPrice();
    });
}

if (wdp_script_data_pro.create_on_load) {
    jQuery(document).ready(function () {
        dynamicPrices = createDynamicPrice();

        jQuery('.variations_form').on('found_variation', {variationForm: this},
            function (event, variation) {
                if (typeof variation !== 'undefined') {
                    setTimeout(function () {
                        dynamicPrices.forEach(function (dynamicPrice) {
                            if (dynamicPrice.form[0] !== undefined && dynamicPrice.form[0] === event.target) {
                                dynamicPrice.__update(dynamicPrice.__getQty())
                            }
                        });
                    }, 0);
                }

                return true;
            });
    });
}
