(function(exports) {
	"use strict";
	
	var xDomainCookie = function( iframe_path, namespace, iframe_load_timeout_ms ){
		//iframe_path = full TLD (and optional path) to location where iframe_shared_cookie.html is served from, and domain cookie will be set on
		//namespace = namespace to use when identifying that postMessage calls incoming are for our use

		if( iframe_path.substr(0,2)=='//' ) iframe_path = (window.location.protocol=='https:'?'https:':'http:')+iframe_path; //verify protocol is present & used

		var _namespace = namespace || 'xdsc',						//namespace for the shared cookie in case there are multiple instances on one page - prevents postMessage collision
			_load_wait_ms = iframe_load_timeout_ms || (1000*6), 	//wait 6 seconds if no other overloaded wait time specified
			_iframe_ready = false,									//has the iframe posted back as ready?
			_iframe_load_error = false,								//was there an error loading the iframe from specified iframe_path in designated iframe_load_timeout_ms?
			_callbacks = [],										//list of pending callbacks to ping when iframe is ready or err occurs
			_xdomain_cookie_data = {},								//shared cookie data set by the iframe after load/ready
			_id = new Date().getTime(),							//identifier to use for iframe in case there are multiple on the page
			_default_expires_days = 30;								//default expiration days for cookies when re-uppded

		//function called on inbound post message - filter/verify that message is for our consumption, then set ready data an fire callbacks
		function _inbound_postmessage( event ){
			try{
	        	var data = JSON.parse(event.data);
	        }catch(e){
	        	var data = null;
	        }
	        if(typeof data=='object' &&  'msg_type' in data && data.msg_type=='xdsc_read' && 'namespace' in data && data.namespace === _namespace){
	        	//NOTE - the only thing iframe postMessages to us is when it's initially loaded, and it includes payload of all cookies set on iframe domain
	        	_xdomain_cookie_data = data.cookies;
				_iframe_ready = true;
				_fire_pending_callbacks();
	        }
		}	

		//an error occured loading the iframe from specified source (based on timeout)
		function _iframe_load_error_occured(){
			_iframe_load_error = true;
			_fire_pending_callbacks();
		}

		//wait until iframe is loaded & ready, or an error occurs, then execute callbakcfunction
		function _on_iframe_ready_or_error( cb ){
			_callbacks.push( cb );
			_fire_pending_callbacks();
		}

		//run all pending callbacks that are registered
		function _fire_pending_callbacks(){
			if( !_iframe_load_error && !_iframe_ready ) return; //not yet ready to fire callbacks, still waiting on error or ready
			while(_callbacks.length>0){
				_callbacks.pop()( _iframe_load_error );
			}
		}

		//set a cookie in the iframe @ iframe_path
		function _set_cookie_in_iframe( cookie_name, cookie_value, expires_days ){
			//NOTE - this function is only called from within _on_iframe_ready_or_err  function when there is NOT an error
			//so we can safely assume iframe is present, ready, and callable at this point

			//postMessage to Iframe w/ info
			var data = {
				namespace: _namespace,
				msg_type: 'xdsc_write',
				cookie_name: cookie_name,
				cookie_val: cookie_value,
				expires_days: expires_days
			};

			document.getElementById('xdomain_cookie_'+_id).contentWindow.postMessage(JSON.stringify(data), iframe_path );
		}

		//basic local cookie getter function
		function _get_local_cookie( cookie_name ){
			var name = cookie_name + "=";
		    var ca = document.cookie.split(';');
		    for(var i=0; i<ca.length; i++) {
		        var c = ca[i].trim();
		        if (c.indexOf(name) === 0) return decodeURIComponent( c.substring(name.length,c.length) );
		    }
		    return "";
		}

		//basic local cookie setter function
		function _set_local_cookie( cookie_name, cookie_value, expires_days ){
			var d = new Date();
		    d.setTime(d.getTime() + ( expires_days*1000*60*60*24) );
		    document.cookie = cookie_name + "=" + cookie_value + "; expires="+d.toUTCString();
		}

		//function to set the value for both cookies (local & xdomain)
		function _set_xdomain_cookie_value( cookie_name, cookie_value, expires_days ){

			expires_days = expires_days || _default_expires_days;
			//if cookie is empty (null or undefined) delete the cookie
			expires_days = (cookie_value===null || cookie_value===undefined) ? -100 : expires_days;

			_set_local_cookie( cookie_name, cookie_value, expires_days );

			if(_iframe_ready && !_iframe_load_error){
				_set_cookie_in_iframe( cookie_name, cookie_value, expires_days );
			}

		}

		//function to call after instantiation to sync a cookie, supplying a cookie name, value to write if it does NOT exist, expires 
		//time (in ms from now), and a callback for completion (which includes the resolved cookie value as the only argument)
		function _get_xdomain_cookie_value( cookie_name, callback, expires_days ){
			
			expires_days = expires_days || _default_expires_days;

			//cb function to create closure for pending user callback
			function _cb( xdomain_success, cookie_val, callback ){

				//re-up the cookie
				_set_xdomain_cookie_value( cookie_name, cookie_val, expires_days );

				if(typeof callback == 'function') callback( cookie_val );
			}

			//see if local cookie is set - if so, no need to wait for iframe to fetch cookie
			var _existing_local_cookie_val = _get_local_cookie( cookie_name );
			if(_existing_local_cookie_val){
				//set onready call to write-through cookie once iframe is ready, then call callback directly
				_on_iframe_ready_or_error( function( is_err ){
					_cb( !is_err, _existing_local_cookie_val );
				});
				return callback( _existing_local_cookie_val );
			} 

			//no local cookie is set/present, so bind CB to iframe ready/error callback so it's pinged a soon as we hit a ready state from iframe
			_on_iframe_ready_or_error(function( is_err ){

				//if an error occurs loading the iframe, return appropriate response w/ callback
				if(is_err) return _cb( false, null, callback );
				
				var _current_cookie_val = cookie_name in _xdomain_cookie_data ? _xdomain_cookie_data[cookie_name] : null;
				_cb( !is_err, _current_cookie_val, callback );

			});
		}

		//bind postmessage listeners for incoming messages from iframe
		window.addEventListener('message', _inbound_postmessage);

		//create hidden iframe on the page that loads from same domain as this script and is used for communication / cookie setting
		var ifr = document.createElement('iframe');
		ifr.style.display = 'none';
		ifr.id = 'xdomain_cookie_'+_id;
		var data = {
			namespace: _namespace,
			origin: window.location.origin
		};
		ifr.src = iframe_path+'/xdomain_cookie.html#'+encodeURIComponent(JSON.stringify(data));
		document.body.appendChild( ifr );

		//set timeout to specify load error if iframe doesn't load in _load_wait_ms
		setTimeout( 
			function(){
				if(!_iframe_ready) _iframe_load_error_occured();
			}, 
			_load_wait_ms 
		);

		return {
			get: _get_xdomain_cookie_value,
			set: _set_xdomain_cookie_value
		};
	};
	
	exports.xDomainCookie = xDomainCookie;
})(this);


/*

//EXAMPLE OF USAGE

var shared_cookie = xDomainSharedCookie( 'https://shared.contently.com', 'contently.ifsc' );
var _temp_id = generate_new_user_id_for_use_if_cookie_not_set();

shared_cookie.create(
	'whatever_cookie_name', //cookie name
	 _temp_id,	//cookie value to use if not set
	(1000*60*60*24*30), // expiration future milliseconds for cookei (30 days here)
	function( cookie_val ){
		//callback for cookie fetch finalization
		//NOTE - cookie will be read/set locally regardless, but success of setting cross-domain version is first param for callback
		_set_user_cookie_id_for_etl_pipeline( cookie_val );
	}
);

*/