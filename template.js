const getAllEventData = require('getAllEventData');
const JSON = require('JSON');
const generateRandom = require('generateRandom');
const getCookieValues = require('getCookieValues');
const getTimestampMillis = require('getTimestampMillis');
const getContainerVersion = require('getContainerVersion');
const logToConsole = require('logToConsole');
const getRequestHeader = require('getRequestHeader');
const makeString = require('makeString');
const makeInteger = require('makeInteger');
const sendHttpRequest = require('sendHttpRequest');
const setCookie = require('setCookie');
const getType = require('getType');
const BigQuery = require('BigQuery');
const toBase64 = require('toBase64');

/**********************************************************************************************/

const traceId = getRequestHeader('trace-id');

const eventData = getAllEventData();

if (!isConsentGivenOrNotRequired()) {
  return data.gtmOnSuccess();
}

const url = eventData.page_location || getRequestHeader('referer');
if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
  return data.gtmOnSuccess();
}

const actionHandlers = {
  trackPageView: trackPageView,
  trackScreenView: trackScreenView,
  trackEvent: trackEvent,
  identifyUser: identifyUser,
  addUserToGroup: addUserToGroup
};

const handler = actionHandlers[data.type];
if (handler) {
  let mappedData = {};
  mappedData = addCommonProperties(data, eventData, mappedData); // Present in all requests
  mappedData = addContext(data, eventData, mappedData); // Present in all requests
  handler(data, eventData, mappedData);
} else {
  return data.gtmOnFailure();
}

if (data.useOptimisticScenario) {
  return data.gtmOnSuccess();
}

/**********************************************************************************************/
// Vendor related functions

function addCommonProperties(data, eventData, mappedData) {
  if (data.messageId) mappedData.messageId = data.messageId;
  if (data.timestamp) mappedData.timestamp = data.timestamp;

  if (data.userId) mappedData.userId = data.userId;
  if (data.anonymousId) mappedData.anonymousId = data.anonymousId;
  else if (isUIFieldTrue(data.generateAnonymousIdCookie)) {
    const anonymousId = getCookieValues('ajs_anonymous_id')[0] || generateUUID();
    mappedData.anonymousId = anonymousId;
    const cookieOptions = {
      domain: data.anonIdCookieDomain || 'auto',
      samesite: 'Lax',
      path: '/',
      secure: true,
      httpOnly: false,
      'max-age': 60 * 60 * 24 * (makeInteger(data.anonIdCookieExpiration) || 365)
    };
    setCookie('ajs_anonymous_id', anonymousId, cookieOptions);
  }

  return mappedData;
}

function addContext(data, eventData, mappedData) {
  const context = {
    // The API ignores empty objects.
    campaign: {},
    page: {},
    app: {},
    device: {},
    network: {},
    os: {},
    library: {
      name: 'gtmserver-stape',
      version: '1.0'
    }
  };

  if (eventData.ip_override) context.ip = eventData.ip_override;
  if (isUIFieldTrue(data.redactIpAddress)) context.ip = '0.0.0.0';

  if (eventData.user_agent) context.userAgent = eventData.user_agent;

  if (eventData.language) context.locale = eventData.language;

  if (eventData.page_path) context.page.path = eventData.page_path;
  if (eventData.page_referrer) context.page.referrer = eventData.page_referrer;
  if (eventData.page_title) context.page.title = eventData.page_title;
  if (eventData.page_location) context.page.url = eventData.page_location;

  if (eventData.app_id) context.app.name = eventData.app_id;
  if (eventData.app_version) context.app.version = eventData.app_version;

  if (eventData['x-ga-device_model']) context.device.model = eventData['x-ga-device_model'];
  // Firebase - IDFA (iOS) or GAID (Google) || IDFV (iOS)
  if (eventData['x-ga-resettable_device_id'] || eventData['x-ga-vendor_device_id']) {
    context.device.advertisingId =
      eventData['x-ga-resettable_device_id'] || eventData['x-ga-vendor_device_id'];
  }

  if (eventData['x-ga-platform']) context.os.name = eventData['x-ga-platform'];
  if (eventData['x-ga-os_version']) context.os.version = eventData['x-ga-os_version'];

  if (data.contextPropertiesList) {
    data.contextPropertiesList.forEach((d) => {
      if (
        ['campaign', 'page', 'app', 'device', 'network', 'os'].indexOf(d.name) !== -1 &&
        getType(d.value) === 'object'
      ) {
        for (const key in d.value) {
          context[d.name][key] = d.value[key];
        }
      } else {
        context[d.name] = d.value;
      }
    });
  }

  mappedData.context = context;

  return mappedData;
}

function addUserTraits(data, eventData, mappedData) {
  const userTraits = {};

  if (data.userTraitsObject) mergeObj(userTraits, data.userTraitsObject);
  if (data.userTraitsList) {
    data.userTraitsList.forEach((d) => (userTraits[d.name] = d.value));
  }
  if (data.customUserTraitsList) {
    data.customUserTraitsList.forEach((d) => (userTraits[d.name] = d.value));
  }

  mappedData.traits = userTraits;

  return mappedData;
}

function identifyUser(data, eventData, mappedData) {
  mappedData = addUserTraits(data, eventData, mappedData);

  return sendRequest({
    path: '/identify',
    body: mappedData
  });
}

function addGroupTraits(data, eventData, mappedData) {
  const groupTraits = {};

  mappedData.groupId = data.groupId;

  if (data.groupTraitsObject) mergeObj(groupTraits, data.groupTraitsObject);
  if (data.groupTraitsList) {
    data.groupTraitsList.forEach((d) => (groupTraits[d.name] = d.value));
  }
  if (data.customGroupTraitsList) {
    data.customGroupTraitsList.forEach((d) => (groupTraits[d.name] = d.value));
  }

  mappedData.traits = groupTraits;

  return mappedData;
}

function addUserToGroup(data, eventData, mappedData) {
  mappedData = addGroupTraits(data, eventData, mappedData);

  return sendRequest({
    path: '/group',
    body: mappedData
  });
}

function addPageProperties(data, eventData, mappedData) {
  const pageProperties = {};

  const commonPagePropertiesInContext = ['url', 'title', 'referrer', 'path', 'search', 'name'];
  // Sync with mappedData.context.page
  if (mappedData.context.page) {
    commonPagePropertiesInContext.forEach((p) => {
      if (isValidValue(mappedData.context.page[p])) {
        if (p === 'name') mappedData.name = mappedData.context.page[p];
        else pageProperties[p] = mappedData.context.page[p];
      }
    });
  }

  if (data.pageViewPageNameProperty) mappedData.name = data.pageViewPageNameProperty;
  if (data.pageViewPropertiesObject) mergeObj(pageProperties, data.pageViewPropertiesObject);
  if (data.pageViewPropertiesList) {
    data.pageViewPropertiesList.forEach((d) => (pageProperties[d.name] = d.value));
  }
  if (data.pageViewCustomPropertiesList) {
    data.pageViewCustomPropertiesList.forEach((d) => (pageProperties[d.name] = d.value));
  }

  mappedData.properties = pageProperties;

  // Sync again with mappedData.context.page
  mappedData.context.page = mappedData.context.page || {};
  commonPagePropertiesInContext.forEach((p) => {
    if (isValidValue(pageProperties[p])) {
      mappedData.context.page[p] = p !== 'name' ? pageProperties[p] : mappedData.name;
    }
  });

  return mappedData;
}

function trackPageView(data, eventData, mappedData) {
  mappedData = addPageProperties(data, eventData, mappedData);

  return sendRequest({
    path: '/page',
    body: mappedData
  });
}

function addScreenProperties(data, eventData, mappedData) {
  const screenProperties = {};

  if (data.screenViewScreenNameProperty) mappedData.name = data.screenViewScreenNameProperty;
  if (data.screenViewPropertiesObject) mergeObj(screenProperties, data.screenViewPropertiesObject);
  if (data.screenViewCustomPropertiesList) {
    data.screenViewCustomPropertiesList.forEach((d) => (screenProperties[d.name] = d.value));
  }

  mappedData.properties = screenProperties;

  return mappedData;
}

function trackScreenView(data, eventData, mappedData) {
  mappedData = addScreenProperties(data, eventData, mappedData);

  return sendRequest({
    path: '/screen',
    body: mappedData
  });
}

function mapEventName(data, eventData) {
  if (data.eventType === 'inherit') {
    const eventName = eventData.event_name;

    const gaToEventName = {
      search: 'Products Searched',
      view_item_list: 'Product List Viewed',
      select_item: 'Product Clicked',
      view_item: 'Product Viewed',
      add_to_cart: 'Product Added',
      remove_from_cart: 'Product Removed',
      share: 'Product Shared',
      view_cart: 'Cart Viewed',
      begin_checkout: 'Checkout Started',
      add_payment_info: 'Payment Info Entered',
      purchase: 'Order Completed',
      refund: 'Order Refunded',
      view_promotion: 'Promotion Viewed',
      select_promotion: 'Promotion Clicked',
      add_to_wishlist: 'Product Added to Wishlist',

      'gtm4wp.addProductToCartEEC': 'Product Added',
      'gtm4wp.productClickEEC': 'Product Clicked',
      'gtm4wp.checkoutOptionEEC': 'Checkout Started',
      'gtm4wp.orderCompletedEEC': 'Order Completed',

      first_open: 'Application Installed',
      app_update: 'Application Updated',
      app_remove: 'Application Uninstalled',
      app_exception: 'Application Crashed'
    };

    if (gaToEventName[eventName]) {
      return gaToEventName[eventName];
    }

    return eventName;
  }

  return data.eventType === 'standard' ? data.eventNameStandard : data.eventNameCustom;
}

function addEventProperties(data, eventData, mappedData) {
  const eventProperties = {};

  // App Events
  if (mappedData.context.app && mappedData.context.app.version) {
    eventProperties.version = mappedData.context.app.version;
  }
  if (eventData.previous_app_version || eventData['x-ga-previous_app_version']) {
    eventProperties.previous_version =
      eventData.previous_app_version || eventData['x-ga-previous_app_version'];
  }

  // GA4 Ecommerce Events
  const gaToEcommerceProperties = {
    search_term: 'query',
    item_list_id: 'list_id',
    item_list_name: 'category',
    promotion_id: 'promotion_id',
    promotion_name: 'name',
    creative_name: 'creative',
    creative_slot: 'position',
    transaction_id: 'order_id',
    shipping: 'shipping',
    tax: 'tax',
    coupon: 'coupon',
    payment_type: 'payment_method',
    shipping_tier: 'shipping_method',
    method: 'share_via'
  };

  let currencyFromItems;
  let valueFromItems;
  if (eventData.items && eventData.items[0]) {
    valueFromItems = 0;
    eventProperties.products = [];
    currencyFromItems = eventData.items[0].currency;
    const itemIdKey = data.itemIdKey ? data.itemIdKey : 'item_id';
    eventData.items.forEach((item) => {
      const product = {};
      if (item[itemIdKey]) product.product_id = makeString(item[itemIdKey]);
      if (item.item_name) product.name = item.item_name;
      if (item.sku) product.sku = item.sku;
      if (item.item_brand) product.brand = item.item_brand;
      if (item.item_category) product.category = item.item_category;
      if (item.item_variant) product.variant = item.item_variant;
      if (item.item_list_id) product.list_id = item.item_list_id;
      if (item.url) product.url = item.url;
      if (item.image_url) product.image_url = item.image_url;
      if (item.quantity) product.quantity = makeInteger(item.quantity);
      if (item.coupon) product.coupon = item.coupon;
      if (item.index) product.position = item.index;
      if (item.price) {
        product.price = makeString(item.price);
        valueFromItems += item.quantity ? item.quantity * item.price : item.price;
      }
      eventProperties.products.push(product);
    });
  }

  if (isValidValue(eventData.value)) eventProperties.revenue = eventData.value;
  else if (isValidValue(valueFromItems)) eventProperties.revenue = valueFromItems;

  const currency = eventData.currency || currencyFromItems;
  if (currency) eventProperties.currency = currency;

  for (const gaProperty in gaToEcommerceProperties) {
    if (!isValidValue(eventData[gaProperty])) continue;
    const property = gaToEcommerceProperties[gaProperty];
    eventProperties[property] = eventData[gaProperty];
  }

  // UI Fields
  if (data.eventPropertiesObject) mergeObj(eventProperties, data.eventPropertiesObject);
  if (data.eventPropertiesList) {
    data.eventPropertiesList.forEach((d) => (eventProperties[d.name] = d.value));
  }
  if (data.eventCustomPropertiesList) {
    data.eventCustomPropertiesList.forEach((d) => (eventProperties[d.name] = d.value));
  }

  mappedData.properties = eventProperties;

  return mappedData;
}

function trackEvent(data, eventData, mappedData) {
  mappedData.event = mapEventName(data, eventData);
  mappedData = addEventProperties(data, eventData, mappedData);

  return sendRequest({
    path: '/track',
    body: mappedData
  });
}

function getRequestBaseUrl() {
  return 'https://cdp' + (data.apiRegion === 'eu' ? '-eu' : '') + '.customer.io/v1';
}

function generateRequestHeaders() {
  return {
    Authorization: 'Basic ' + toBase64(data.apiKey + ':'),
    'Content-Type': 'application/json'
  };
}

function areThereRequiredFieldsMissing(requestPath, payload) {
  const requiredCommonFields = ['userId', 'anonymousId'];
  const requiredFieldsByRequestPath = {
    '/group': ['groupId'],
    '/track': ['event']
  };

  const commonFieldsMissing = requiredCommonFields.every((p) => !isValidValue(payload[p]));
  if (commonFieldsMissing) return requiredCommonFields;

  const fieldsMissing = (requiredFieldsByRequestPath[requestPath] || []).some(
    (p) => !isValidValue(payload[p])
  );
  if (fieldsMissing) return requiredFieldsByRequestPath[requestPath];
}

function sendRequest(requestData) {
  const missingFields = areThereRequiredFieldsMissing(requestData.path, requestData.body);
  if (missingFields) {
    log({
      Name: 'Customer.io',
      Type: 'Message',
      TraceId: traceId,
      EventName: requestData.path,
      Message: 'Request was not sent.',
      Reason: 'One or more required properties are missing: ' + missingFields.join(' or ')
    });

    return data.gtmOnFailure();
  }

  const requestUrl = getRequestBaseUrl() + requestData.path;

  log({
    Name: 'Customer.io',
    Type: 'Request',
    TraceId: traceId,
    EventName: requestData.path,
    RequestMethod: 'POST',
    RequestUrl: requestUrl,
    RequestBody: requestData.body
  });

  return sendHttpRequest(
    requestUrl,
    (statusCode, headers, body) => {
      log({
        Name: 'Customer.io',
        Type: 'Response',
        TraceId: traceId,
        EventName: requestData.path,
        ResponseStatusCode: statusCode,
        ResponseHeaders: headers,
        ResponseBody: body
      });

      if (!data.useOptimisticScenario) {
        let parsedBody = {};
        if (body) parsedBody = JSON.parse(body);

        if (
          statusCode >= 200 &&
          statusCode < 400 &&
          getType(parsedBody) === 'object' &&
          parsedBody.success
        ) {
          data.gtmOnSuccess();
        } else {
          data.gtmOnFailure();
        }
      }
    },
    {
      headers: generateRequestHeaders(),
      method: 'POST'
    },
    JSON.stringify(requestData.body)
  );
}

/**********************************************************************************************/
// Helpers

function random() {
  return generateRandom(1000000000000000, 10000000000000000) / 10000000000000000;
}

function generateUUID() {
  function s(n) {
    return h((random() * (1 << (n << 2))) ^ getTimestampMillis()).slice(-n);
  }
  function h(n) {
    return (n | 0).toString(16);
  }
  return [
    s(4) + s(4),
    s(4),
    '4' + s(3),
    h(8 | (random() * 4)) + s(3),
    getTimestampMillis().toString(16).slice(-10) + s(2)
  ]
    .join('-')
    .toUpperCase();
}

function isUIFieldTrue(field) {
  return [true, 'true'].indexOf(field) !== -1;
}

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '';
}

function mergeObj(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key)) target[key] = source[key];
  }
  return target;
}

function isConsentGivenOrNotRequired() {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
  return xGaGcs[2] === '1';
}

function log(rawDataToLog) {
  const logDestinationsHandlers = {};
  if (determinateIsLoggingEnabled()) logDestinationsHandlers.console = logConsole;
  if (determinateIsLoggingEnabledForBigQuery()) logDestinationsHandlers.bigQuery = logToBigQuery;

  // Key mappings for each log destination
  const keyMappings = {
    // No transformation for Console is needed.
    bigQuery: {
      Name: 'tag_name',
      Type: 'type',
      TraceId: 'trace_id',
      EventName: 'event_name',
      RequestMethod: 'request_method',
      RequestUrl: 'request_url',
      RequestBody: 'request_body',
      ResponseStatusCode: 'response_status_code',
      ResponseHeaders: 'response_headers',
      ResponseBody: 'response_body'
    }
  };

  for (const logDestination in logDestinationsHandlers) {
    const handler = logDestinationsHandlers[logDestination];
    if (!handler) continue;

    const mapping = keyMappings[logDestination];
    const dataToLog = mapping ? {} : rawDataToLog;
    // Map keys based on the log destination
    if (mapping) {
      for (const key in rawDataToLog) {
        const mappedKey = mapping[key] || key; // Fallback to original key if no mapping exists
        dataToLog[mappedKey] = rawDataToLog[key];
      }
    }

    handler(dataToLog);
  }
}

function logConsole(dataToLog) {
  logToConsole(JSON.stringify(dataToLog));
}

function logToBigQuery(dataToLog) {
  const connectionInfo = {
    projectId: data.logBigQueryProjectId,
    datasetId: data.logBigQueryDatasetId,
    tableId: data.logBigQueryTableId
  };

  // timestamp is required.
  dataToLog.timestamp = getTimestampMillis();

  // Columns with type JSON need to be stringified.
  ['request_body', 'response_headers', 'response_body'].forEach((p) => {
    // GTM Sandboxed JSON.parse returns undefined for malformed JSON but throws post-execution, causing execution failure.
    // If fixed, could use: dataToLog[p] = JSON.stringify(JSON.parse(dataToLog[p]) || dataToLog[p]);
    dataToLog[p] = JSON.stringify(dataToLog[p]);
  });

  // assertApi doesn't work for 'BigQuery.insert()'. It's needed to convert BigQuery into a function when testing.
  // Ref: https://gtm-gear.com/posts/gtm-templates-testing/
  const bigquery =
    getType(BigQuery) === 'function' ? BigQuery() /* Only during Unit Tests */ : BigQuery;
  bigquery.insert(connectionInfo, [dataToLog], { ignoreUnknownValues: true });
}

function determinateIsLoggingEnabled() {
  const containerVersion = getContainerVersion();
  const isDebug = !!(
    containerVersion &&
    (containerVersion.debugMode || containerVersion.previewMode)
  );

  if (!data.logType) {
    return isDebug;
  }

  if (data.logType === 'no') {
    return false;
  }

  if (data.logType === 'debug') {
    return isDebug;
  }

  return data.logType === 'always';
}

function determinateIsLoggingEnabledForBigQuery() {
  if (data.bigQueryLogType === 'no') return false;
  return data.bigQueryLogType === 'always';
}
