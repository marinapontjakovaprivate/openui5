/*!
 * ${copyright}
 */
sap.ui.require([
	"sap/ui/base/ManagedObject",
	"sap/ui/model/ChangeReason",
	"sap/ui/model/Context",
	"sap/ui/model/Model",
	"sap/ui/model/odata/v4/ODataListBinding",
	"sap/ui/model/odata/v4/ODataModel",
	"sap/ui/thirdparty/odatajs-4.0.0"
], function (ManagedObject, ChangeReason, Context, Model, ODataListBinding, ODataModel, Olingo) {
	/*global odatajs, QUnit, sinon */
	/*eslint no-warning-comments: 0 */
	"use strict";

	var TestControl = ManagedObject.extend("sap.ui.core.test.TestControl", {
		metadata : {
			aggregations : {
				items : {multiple : true, type : "sap.ui.core.test.TestControl"}
			}
		}
	});

	// Creates a jQuery.promise as mock for DataCache.readRange which is fulfilled asynchronously
	// with the given vResult. The result either holds a number determining the length of the
	// array with which the promise is resolved or an Error object with which it is rejected.
	function createDeferredResult(vResult) {
		var oDeferred = odatajs.deferred.createDeferred();

		setTimeout(function () {
			var oData,
				i;

			if (vResult instanceof Error) {
				oDeferred.reject(vResult);
				return;
			}

			oData = {value : []};
			for (i = 0; i < vResult; i += 1) {
				oData.value[i] = {Name : "Name " + i};
			}
			oDeferred.resolve(oData);
		}, 0);
		return oDeferred.promise();
	}

	//*********************************************************************************************
	QUnit.module("sap.ui.model.odata.v4.ODataListBinding", {
		beforeEach : function () {
			var oDataCache = {readRange : function() {}};

			this.oSandbox = sinon.sandbox.create();

			this.oLogMock = this.oSandbox.mock(jQuery.sap.log);
			this.oLogMock.expects("error").never();
			this.oLogMock.expects("warning").never();

			// create ODataModel and mock Olingo DataCache for source /service/Products
			this.oModel = new ODataModel("/service");
			this.oModel.setSizeLimit(3);
			this.oDataCacheMock = this.oSandbox.mock(oDataCache);
			this.oSandbox.stub(odatajs.cache, "createDataCache").returns(oDataCache);
		},
		afterEach : function () {
			// I would consider this an API, see https://github.com/cjohansen/Sinon.JS/issues/614
			this.oSandbox.verifyAndRestore();
		}
	});

	//*********************************************************************************************
	QUnit.test("getContexts creates cache once", function (assert) {
		this.oDataCacheMock.expects("readRange").returns(createDeferredResult(0));

		this.oModel.bindList("/Products").getContexts();

		assert.ok(odatajs.cache.createDataCache.calledWithExactly({
			mechanism : "memory",
			name : "/service/Products",
			source : "/service/Products"
		}), odatajs.cache.createDataCache.printf("cache creation settings %C"));
	});

	//*********************************************************************************************
	QUnit.test("getContexts creates cache once for list with context", function (assert) {
		var oContext = new Context(this.oModel, "/Products(1)");

		this.oDataCacheMock.expects("readRange").returns(createDeferredResult(0));
		this.mock(this.oModel).expects("resolve")
			.withExactArgs("Suppliers", oContext).returns("/Resolved");

		this.oModel.bindList("Suppliers", oContext).getContexts();

		assert.ok(odatajs.cache.createDataCache.calledWithExactly({
			mechanism : "memory",
			name : "/service/Resolved",
			source : "/service/Resolved"
		}), odatajs.cache.createDataCache.printf("cache creation settings %C"));

	});

	//*********************************************************************************************
	// fixture with range for aggregation binding info (default {}) and
	//              number of entities (default is length requested to readRange)
	[
		{range : {}},
		{range : {startIndex : 1, length : 3}},
		{range : {startIndex : 1, length : 3}, entityCount : 2}
	].forEach(function (oFixture) {
		QUnit.test("getContexts satisfies contract of ManagedObject#bindAggregation "
			+ JSON.stringify(oFixture),
		function (assert) {
			var oControl = new TestControl(),
				done = assert.async(),
				oRange = oFixture.range || {},
				iLength = oRange.length || this.oModel.iSizeLimit,
				iEntityCount = oFixture.entityCount || iLength,
				iStartIndex = oRange.startIndex || 0;

			// check that given spy is called with exact arguments
			function checkCall(oSpy) {
				assert.ok(
					oSpy.calledWithExactly.apply(oSpy, Array.prototype.slice.call(arguments, 1)),
					oSpy.printf("%n call %C"));
			}

			// change event handler for initial read for list binding
			function onChange() {
				var aChildControls = oControl.getItems(),
					sExpectedPath,
					iListIndex = oControl.getBinding("items").iIndex,
					i;

				assert.strictEqual(aChildControls.length, iEntityCount, "# child controls");
				for (i = 0; i < iEntityCount; i += 1) {
					sExpectedPath = "/Products[" + (i + iStartIndex) + "];list=" + iListIndex;
					assert.strictEqual(aChildControls[i].getBindingContext().getPath(),
						sExpectedPath, "child control binding path: " + sExpectedPath);
				}
				done();
			}

			this.oDataCacheMock.expects("readRange")
				.withExactArgs(iStartIndex, iLength)
				.twice()
				.returns(createDeferredResult(iEntityCount));
			// spies to check and document calls to model and binding methods from ManagedObject
			this.spy(this.oModel, "bindList");
			this.spy(ODataListBinding.prototype, "checkUpdate");
			this.spy(ODataListBinding.prototype, "getContexts");

			// code under test
			oControl.setModel(this.oModel);
			oControl.bindAggregation("items", jQuery.extend({
				path : "/Products",
				template : new TestControl()
			}, oRange));

			// check v4 ODataModel APIs are called as expected from ManagedObject
			checkCall(this.oModel.bindList, "/Products", undefined, undefined, undefined,
				undefined);
			checkCall(ODataListBinding.prototype.checkUpdate, true);
			checkCall(ODataListBinding.prototype.getContexts, oRange.startIndex, oRange.length);

			oControl.getBinding("items").attachChange(onChange);
			assert.deepEqual(oControl.getItems(), [], "initial synchronous result");
		});
	});

	//*********************************************************************************************
	QUnit.test("checkUpdate fires change event", function () {
		var oListBinding = this.oModel.bindList("/Products");

		this.mock(oListBinding).expects("_fireChange")
			.withExactArgs({reason : ChangeReason.Change}).twice();

		oListBinding.checkUpdate();
		oListBinding.checkUpdate(true);
		//TODO check last read range for an update and only send change event then
	});

	//*********************************************************************************************
	QUnit.test("getContexts called directly provides contexts as return value and in change event",
		function (assert) {
		var done = assert.async(),
			oListBinding = this.oModel.bindList("/Products"),
			iSizeLimit = this.oModel.iSizeLimit,
			iRangeIndex = 0;

		// fixture with array of ranges for getContexts calls with
		//   start, length - determine the range
		//   sync - array with flags which indexes are to return a context synchronously to
		//     simulate previous calls to getContexts
		var oFixture  = [
			{sync: []},
			{start : iSizeLimit, length : 1, sync : []}, // completely new contexts
			{start : iSizeLimit, length : 2, sync : [true]}, // partially new contexts
			{start : iSizeLimit, length : 2, sync : [true, true]}
				// completely existing contexts
			],
			that = this;

		// call getContexts for current range; considers previously accessed indexes
		// only if used to check synchronous return value of getContexts.
		function checkContexts(bSync) {
			var aContexts,
				i,
				iLength = oFixture[iRangeIndex].length || iSizeLimit,
				iStart = oFixture[iRangeIndex].start || 0,
				sMessage;

			that.oDataCacheMock.expects("readRange")
				.withExactArgs(iStart, iLength)
				.once()
				.returns(createDeferredResult(iLength));

			// code under test, read synchronously with previous range
			aContexts = oListBinding.getContexts(iStart, iLength);

			for (i = 0; i < iLength; i += 1) {
				sMessage = (bSync ? "Synchronous" : "Asynchronous") + " result"
					+ "/Products[" + (iStart + i) + "], getContexts("
					+ iStart + "," + iLength + ")";
				if (bSync && !oFixture[iRangeIndex].sync[i]) {
					assert.strictEqual(aContexts[i], undefined, sMessage);
				} else {
					assert.strictEqual(aContexts[i].getPath(),
						"/Products[" + (iStart + i)  + "];list=" + oListBinding.iIndex,
						sMessage);
				}
			}
		}

		// change event handler for list binding
		function onChange() {
			checkContexts();
			iRangeIndex += 1;
			checkContexts(true);
			// only the last range in the fixture triggers no change event
			if (iRangeIndex === oFixture.length - 1) {
				done();
			}
		}

		checkContexts(true);
		oListBinding.attachChange(onChange);
	});

	//*********************************************************************************************
	QUnit.test("getContexts sends no change event on failure of DataCache#readRange and logs error",
			function (assert) {
		var done = assert.async(),
			oError = new Error("Intentionally failed"),
			oListBinding = this.oModel.bindList("/Products"),
			oPromise = createDeferredResult(oError);

		function onChange() {
			var aContexts;

			aContexts = oListBinding.getContexts(1, 2); // failing readRange
			assert.strictEqual(aContexts.length, 1, "contexts from first read still exist");
			oPromise.then(undefined, function () { done(); }); // wait until readRange rejects
		}

		this.oDataCacheMock.expects("readRange").once().returns(createDeferredResult(2));
		this.oDataCacheMock.expects("readRange").once().returns(oPromise);
		this.oLogMock.expects("error")
			.withExactArgs("Failed to get contexts for /service/Products with start index 1 and "
					+ "length 2",
				oError, "sap.ui.model.odata.v4.ODataListBinding");

		oListBinding.attachChange(onChange);
		oListBinding.getContexts(0, 2); // successful readRange

		//TODO implement faultTolerant setting on list binding which keeps existing contexts?
	});

	//*********************************************************************************************
	//TODO unclear how to handle errors in jQuery.Deferred success handlers, open issue on Olingo
	// to use promises
	QUnit.skip("getContexts handles error in change event handler", function (assert) {
		var done = assert.async(),
			oError = new SyntaxError("Intentionally failed"),
			oListBinding = this.oModel.bindList("/Products");

		this.oDataCacheMock.expects("readRange").once().returns(createDeferredResult(1));
		this.oLogMock.expects("error")
			.withExactArgs("Failed to get contexts for /service/Products with start index 0 and "
					+ "length 1",
				oError, "sap.ui.model.odata.v4.ODataListBinding");
		oListBinding.attachChange(function () {
			throw oError;
		});

		oListBinding.getContexts(0, 1);

		setTimeout(done, 10); //TODO Is there a better way to finalize the test after console log?
	});

	//TODO jsdoc: {@link sap.ui.model.odata.v4.ODataModel#bindList bindList} generates no link
	//TODO lists within lists for navigation properties contained in cache via $expand
	//     enhance integration test first!
	//TODO lists within lists for deferred navigation or structural properties
	//TODO (how to) get rid of global cache objects when model is garbage collected
	//TODO integration test for cache eviction if size exceeds cacheSize (1MB per default)
	//TODO (how to) set pageSize, prefetchSize, cacheSize of cache?

	//TODO integration: 3 tables: 2 different entity sets, 2 with same, but different $select
});
