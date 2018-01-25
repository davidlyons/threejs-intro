/**
 * @author Stewart Smith / http://stewartsmith.io
 * @author Moar Technologies Corp / https://moar.io
 * @author Jeff Nusz / http://custom-logic.com
 * @author Data Arts Team / https://github.com/dataarts
 */




/*


	THREE.VRController




	Why is this useful?
	
	1. This creates a THREE.Object3D() per connected Gamepad instance and 
	   passes it to you through a Window event for inclusion in your scene. 
	   It then handles copying the live positions and orientations from the
	   Gamepad instance to this Object3D.
	2. It also broadcasts Gamepad button and axes events to you on this
	   Object3D instance. For your convenience button names are mapped to
	   objects in the buttons array on supported devices. (And this support 
	   is easy to extend.) For implicitly supported devices you can continue
	   to use the buttons array indexes.
	3. This one JS file explicitly supports several existing VR controllers,
	   and implicitly supports any controllers that operate similarly!

	
	What do I have to do?
	
	1. Include THREE.VRController.update() in your animation loop and listen
	   for controller connection events like so:
	   window.addEventlistener('vr controller connected', (controller)=>{}).
	2. When you receive a controller instance -- again, just an Object3D --
	   you ought to set its standingMatrix property equal to your
	   renderer.vr.getStandingMatrix(). If you are expecting a 3DOF controller
	   you must set its head property equal to your camera.
	3. Experiment and HAVE FUN!


*/




    ///////////////////////
   //                   //
  //   VR Controller   //
 //                   //
///////////////////////


THREE.VRController = function( gamepad ) {

	var
		supported,
		hand = '',
		axes = [],
		buttons  = [],
		buttonNamePrimary;

	this.style = '';

	THREE.Object3D.call( this );
	this.matrixAutoUpdate = false;


	//  ATTENTION !
	//
	//  You ought to overwrite these TWO special properties on the instance in
	//  your own code. For example for 6DOF controllers:
	//    controller.standingMatrix = renderer.vr.getStandingMatrix()
	//  And for 3DOF controllers:
	//    controller.head = camera
	//  Quick FYI: “DOF” means “Degrees of Freedom”. If you can rotate about 
	//  3 axes and also move along 3 axes then 3 + 3 = 6 degrees of freedom.

	this.standingMatrix = new THREE.Matrix4();
	this.head = {
		position:   new THREE.Vector3(),
		quaternion: new THREE.Quaternion()
	};


	//  It is crucial that we have a reference to the actual gamepad.
	//  In addition to requiring its .pose for position and orientation
	//  updates, it also gives us all the goodies like .id, .index,
	//  and maybe best of all... haptics!

	this.gamepad       = gamepad;
	this.name          = gamepad.id;
	this.dof           = gamepad.pose ? 3 * ( +gamepad.pose.hasOrientation + +gamepad.pose.hasPosition ) : 0;

	this.axisThreshold = 0.2;
	this.axisPressThreshold = 0.6;
	this.filterAxis = function( v ) {
		return ( Math.abs( v ) > this.axisThreshold ) ? v : 0;
	};

	var scope = this;

	//  If the gamepad has a hapticActuators Array with something valid in
	//  the first slot then we can send it an intensity (from 0 to 1) and a 
	//  duration in milliseconds like so:
	//    gamepad.hapticActuators[ 0 ].pulse( 0.3, 200 )
	//  Or... we can use our own shortcut here which does NOT take a duration:
	//    this.setVibe( 0.3 )
	//  And why is that special? Because you can have multiple channels:
	//    this.setVibe( 'laser', 0.2 ); this.setVibe( 'explosion', 0.9 )
	//  Or even use this syntax for scheduling channel changes!
	//    this.setVibe( 'engine' ).set( 0.8 )
	//      .wait(  500 ).set( 0.1 )
	//      .wait( 1000 ).set( 0.0 )

	const vibeChannel = [];
	vibeChannel.name = '';
	vibeChannel.intensity = 0;
	this.vibeChannels = [ vibeChannel ];
	this.vibeChannels.intensity = 0;
	this.vibeChannels.prior = 0;


	//  Do we recognize this type of controller based on its gamepad.id?
	//  If not we'll still roll with it, we just won't have axes and buttons
	//  mapped to convenience strings. No biggie.
	//  Because Microsoft's controller appends unique ID numbers to the end of
	//  its ID string we can no longer just do this:
	//  supported = THREE.VRController.supported[ gamepad.id ]
	//  Instead we must loop through some object keys first.

	supported = THREE.VRController.getSupportedById( gamepad.id );

	//  Setup states so we can watch for change events.
	//  This includes hand, axes, and buttons.

	hand = gamepad.hand;

	axes.byName = {};

	if ( supported !== undefined && supported.axes !== undefined ) {

		supported.axes.forEach( function( axesMap, i ){

			var i0 = axesMap.indexes[0];
			var i1 = axesMap.indexes[1];

			var axisX = gamepad.axes[ i0 ];
			var axisY = gamepad.axes[ i1 ];

			var isThumbstick = axesMap.name.startsWith('thumbstick');

			if ( isThumbstick ) {
				// only apply filter if both axes are below threshold
				var filteredX = scope.filterAxis( axisX );
				var filteredY = scope.filterAxis( axisY );
				if ( !filteredX && !filteredY ) {
					axisX = filteredX;
					axisY = filteredY;
				}
			}

			axes[ i ] = {
				name: axesMap.name,
				indexes: axesMap.indexes,
				value: [ axisX, axisY ],
				isThumbstick: isThumbstick
			};

			if ( isThumbstick ) {
				axes[ i ].dpad = {
					'up':    { index: i1, isPressed: false },
					'down':  { index: i1, isPressed: false },
					'left':  { index: i0, isPressed: false },
					'right': { index: i0, isPressed: false }
				};
			}

			axes.byName[ axesMap.name ] = axes[ i ];

		});

	} else {

		for ( var i = 0; i < gamepad.axes.length / 2; i++ ) {
			var i0 = i*2, i1 = i*2+1;

			var axisX = gamepad.axes[ i0 ];
			var axisY = gamepad.axes[ i1 ];

			axes[ i ] = {
				name: 'axes_' + (i+1),
				indexes: [ i0, i1 ],
				value: [ axisX, axisY ]
			};
		}

	}

	var axesNames = Object.keys( axes.byName );


	//  Similarly we’ll create a default set of button objects.

	gamepad.buttons.forEach( function( button, i ) {

		buttons[ i ] = {
			name:     'button_'+ i,
			value:     button.value,
			isTouched: button.touched,
			isPressed: button.pressed,
			isPrimary: false
		};

	});

	if ( supported !== undefined ) {
		this.style = supported.style;

		if ( supported.buttons !== undefined ){
			supported.buttons.forEach( function( buttonName, i ){
				buttons[ i ].name = buttonName;
			});
		}

		buttonNamePrimary = supported.primary;
	}

	buttons.byName = {};
	buttons.forEach( function( button ){
		buttons.byName[ button.name ] = button;
	});

	//  This will allow you to listen for 'primary press began', etc.
	//  even if we don't explicitly support this controller model.
	//  Right now convention seems to be that button #0 will be a thumbpad
	// (Vive, Oculus, Daydream, GearVR) or thumbstick (Microsoft).
	//  If there is a trigger then that sits in slot #1 (Vive, Oculus,
	//  Micrsoft) and becomes the primary button. But if there is no trigger
	//  then the thumbpad becomes the primary button (Daydream, GearVR).

	if( buttonNamePrimary === undefined ) {
		buttonNamePrimary = gamepad.buttons.length > 1 ? 'button_1' : 'button_0';
	}

	if ( buttons.byName[ buttonNamePrimary ] ) {
		buttons.byName[ buttonNamePrimary ].isPrimary = true;
	}


	//  Let's make some getters!

	this.getHand = function(){

		return hand;

	};

	this.getAxes = function( index ) {

		if ( nameOrIndex === undefined ) {
			return axes;
		} else if ( typeof nameOrIndex === 'string' ) {
			return axes.byName[ nameOrIndex ];
		} else if ( typeof nameOrIndex === 'number' ) {
			return axes[ index ];
		}

	};

	this.getButton = function( nameOrIndex ) {

		if ( typeof nameOrIndex === 'string' ) {
			if ( nameOrIndex === 'primary' ) nameOrIndex = buttonNamePrimary;
			return buttons.byName[ nameOrIndex ];
		} else if ( typeof nameOrIndex === 'number' ) {
			return buttons[ nameOrIndex ];
		}

	};

	//  During your development phase you may need to do a reality check for
	//  your own sanity. What controller is this?! What capabilities do we
	//  think it has? This will help!

	this.inspect = function(){ return (

		'#'+ gamepad.index +': '+ gamepad.id +
		'\n\tStyle: '+ this.style +
		'\n\tDOF: '+ this.dof +
		'\n\tHand: '+ hand +
		'\n\n\tAxes: '+ axes.reduce( function( a, e ){ return (

			a +
			'\n\t\tName: "'+ e.name + '"'+
			'\n\t\t\tValue: '+ e.value

		)}, '' ) +
		'\n\n\tButton primary: "'+ buttonNamePrimary +'"'+
		'\n\tButtons:'+ buttons.reduce( function( a, e ){ return (

			a +
			'\n\t\tName: "'+ e.name +'"'+
			'\n\t\t\tValue:     '+ e.value +
			'\n\t\t\tisTouched: '+ e.isTouched +
			'\n\t\t\tisPressed: '+ e.isPressed +
			'\n\t\t\tisPrimary: '+ e.isPrimary

		)}, '' ) +
		'\n\n\tVibration intensity: '+ this.vibeChannels.intensity +
		'\n\tVibration channels:'+ this.vibeChannels.reduce( function( a, e ){ return (

			a +
			'\n\t\tName: "'+ e.name +'"'+
			'\n\t\t\tCurrent intensity: '+ e.intensity +
			e.reduce( function( a2, e2 ){ return (

				a2 + '\n\t\t\tat time '+ e2[ 0 ] +' intensity = '+ e2[ 1 ]

			)}, '' )

		)}, '' )
	)};


	//  Now we're ready to listen and compare saved state to current state.

	this.pollForChanges = function() {

		var
			verbosity  = THREE.VRController.verbosity,
			controller = this,
			controllerInfo = '> #'+ controller.gamepad.index +' '+ controller.gamepad.id +' ';

			if ( hand ) controllerInfo += '(Hand: '+ hand +') ';

		//  Did the hand change?

		if ( hand !== controller.gamepad.hand ) {
			if( verbosity >= 0.4 ) console.log( controllerInfo +'hand changed from "'+ hand +'" to "'+ controller.gamepad.hand +'"' );
			hand = controller.gamepad.hand;
			controller.dispatchEvent({ type: 'hand changed', hand: hand });
		}


		//  update axes

		for ( var i = 0; i < axes.length; i++ ) {
			var i0 = axes[ i ].indexes[0];
			var i1 = axes[ i ].indexes[1];

			if ( gamepad.axes[ i0 ] && gamepad.axes[ i1 ] ) {

				var axesVal = axes[ i ].value;
				var axisX = gamepad.axes[ i0 ];
				var axisY = gamepad.axes[ i1 ];

				if ( axes[ i ].isThumbstick ) {
					// only apply filter if both axes are below threshold
					var filteredX = this.filterAxis( axisX );
					var filteredY = this.filterAxis( axisY );
					if ( !filteredX && !filteredY ) {
						axisX = filteredX;
						axisY = filteredY;
					}
				}

				if ( axesVal[ 0 ] !== axisX || axesVal[ 1 ] !== axisY ) {
					axesVal[ 0 ] = axisX;
					axesVal[ 1 ] = axisY;

					// Vive’s thumbpad is the only controller axes that uses
					// a "Goofy" Y-axis. We’re going to INVERT it so you
					// don’t have to worry about it!
					var axesValues = [ axisX, axisY ];
					if ( this.style === 'vive' && axes[i].name === 'thumbpad' ) {
						axesValues[ 1 ] *= -1;
					}

					if ( verbosity >= 0.7 ) console.log( controllerInfo + axes[i].name + ' axes changed', axesVal );
					controller.dispatchEvent({ type: axes[i].name + ' axes changed', axes: axesValues });
				}

				// emulate d-pad with axes
				if ( axes[ i ].isThumbstick ) {
					var axisDPad = axes[ i ].dpad;
					for ( d in axisDPad ) {
						var axis = axisDPad[d];
						var v = gamepad.axes[ axis.index ];

						if (d == 'right' || d == 'down') {
							var axisPressed = v > this.axisPressThreshold ? v : 0;
						} else if (d == 'left' || d == 'up') {
							var axisPressed = v < -this.axisPressThreshold ? v : 0;
						}

						if ( axis.isPressed !== !!axisPressed ) {
							axis.isPressed = !!axisPressed;
							var eventAction = axis.isPressed ? 'began' : 'ended';
							if ( verbosity >= 0.5 ) console.log( controllerInfo + axes[i].name + ' ' + d + ' press ' + eventAction );
							this.dispatchEvent({ type: axes[i].name + ' ' + d + ' press ' + eventAction });
						}
					}
				}

			}
		}

		//  Did any button states change?

		buttons.forEach( function( button, i ) {

			var
				controllerAndButtonInfo = controllerInfo + button.name +' ',
				isPrimary = button.isPrimary,
				eventAction;


			//  If this button is analog-style then its values will range from
			//  0.0 to 1.0. But if it's binary you'll only received either a 0
			//  or a 1. In that case 'value' usually corresponds to the press
			//  state: 0 = not pressed, 1 = is pressed.

			if ( button.value !== gamepad.buttons[ i ].value ) {
				button.value = gamepad.buttons[ i ].value;
				if( verbosity >= 0.6 ) console.log( controllerAndButtonInfo +'value changed', button.value );
				controller.dispatchEvent({ type: button.name  +' value changed', value: button.value });
				if( isPrimary ) controller.dispatchEvent({ type: 'primary value changed', value: button.value });
			}
			//  Some buttons have the ability to distinguish between your hand
			//  making contact with the button and the button actually being
			//  pressed. (Useful!) Some buttons fake a touch state by using an
			//  analog-style value property to make rules like: for 0.0 .. 0.1
			//  touch = true, and for >0.1 press = true. 
			if ( button.isTouched !== gamepad.buttons[ i ].touched ) {
				button.isTouched = gamepad.buttons[ i ].touched;
				eventAction = button.isTouched ? 'began' : 'ended';
				if( verbosity >= 0.5 ) console.log( controllerAndButtonInfo +'touch '+ eventAction );
				controller.dispatchEvent({ type: button.name  +' touch '+ eventAction });
				if( isPrimary ) controller.dispatchEvent({ type: 'primary touch '+ eventAction});
			}


			//  This is the least complicated button property.

			if( button.isPressed !== gamepad.buttons[ i ].pressed ){

				button.isPressed = gamepad.buttons[ i ].pressed;
				eventAction = button.isPressed ? 'began' : 'ended';
				if( verbosity >= 0.5 ) console.log( controllerAndButtonInfo +'press '+ eventAction );
				controller.dispatchEvent({ type: button.name +' press '+ eventAction });
				if( isPrimary ) controller.dispatchEvent({ type: 'primary press '+ eventAction });
			}

		});

	};

};

THREE.VRController.prototype = Object.create( THREE.Object3D.prototype );
THREE.VRController.prototype.constructor = THREE.VRController;




//  Update the position, orientation, and button states,
//  fire button events if nessary.

THREE.VRController.prototype.update = function(){

	var
		gamepad = this.gamepad,
		pose = gamepad.pose;


	//  Poll for changes in hand, axes, and button states.
	//  If there's a change this function fires the appropriate event.

	this.pollForChanges();

	//  Do we have haptics? Do we have haptic channels? Let's vibrate!

	this.applyVibes();

	//  Once connected a gamepad will have a not-undefined pose
	//  but that pose will be null until a user action ocurrs.
	//  Similarly if a gamepad has powered off or disconnected
	//  the pose will contain all nulls.
	//  We have to check this ourselves because the Gamepad API
	//  might not report a disconnection reliably :'(
	//  Either way, if we’re all null let’s bail by returning early.

	if ( pose === null || pose === undefined || ( pose.orientation === null && pose.position === null )) {

		if ( this.hasPosed === true ) THREE.VRController.onGamepadDisconnect( gamepad );
		return;

	}
	if ( this.hasPosed !== true ) {

		this.hasPosed = true;
		this.visible  = true;

	}


	//  If we’ve gotten to here then gamepad.pose has a definition
	//  so now we can set a convenience variable to know if we are 3DOF or 6DOF.

	// this.dof = ( +gamepad.pose.hasOrientation + +gamepad.pose.hasPosition ) * 3;


	//  ORIENTATION. Do we have data for this?
	//  If so let's use it. If not ... no fallback plan.

	if ( pose.orientation !== null ) this.quaternion.fromArray( pose.orientation );


	//  POSITION -- EXISTS!
	//  If we have position data then we can assume we also have orientation
	//  because this is the expected behavior of 6DOF controllers.
	//  If we don’t have orientation it will just use the previous orientation data.

	if ( pose.position !== null ) {

		this.position.fromArray( pose.position );
		this.matrix.compose( this.position, this.quaternion, this.scale );

	} else {

	//  POSITION -- NOPE ;(
	//  But if we don’t have position data we’ll assume our controller is only 3DOF
	//  and use an arm model that takes head position and orientation into account.
	//  So don’t forget to set controller.head to reference your VR camera so we can
	//  do the following math.


		//  If this is our first go-round with a 3DOF this then we’ll need to
		//  create the arm model.

		if ( this.armModel === undefined ) {

			if( THREE.VRController.verbosity >= 0.5 ) console.log( '> #'+ gamepad.index +' '+ gamepad.id +' (Hand: '+ this.getHand() +') adding OrientationArmModel' )
			this.armModel = new OrientationArmModel();
		}


		//  Now and forever after we can just update this arm model
		//  with the head (camera) position and orientation
		//  and use its output to predict where the this is.

		this.armModel.setHeadPosition( this.head.position );
		this.armModel.setHeadOrientation( this.head.quaternion );
		this.armModel.setControllerOrientation(
			// TODO: Cache this Quaternion
			( new THREE.Quaternion() ).fromArray( pose.orientation ));
		this.armModel.update();
		this.matrix.compose(
			this.armModel.getPose().position,
			this.armModel.getPose().orientation,
			this.scale
		);

	}


	//  Ok, we know where the this ought to be so let’s set that.
	//  For 6DOF controllers it’s necessary to set controller.standingMatrix
	//  to reference your VRControls.standingMatrix, otherwise your controllers
	//  will be on the floor instead of up in your hands!
	//  NOTE: “VRControls” and “VRController” are similarly named but two
	//  totally different things! VRControls is what reads your headset’s
	//  position and orientation, then moves your camera appropriately.
	//  Whereas this VRController instance is for the VR controllers that
	//  you hold in your hands.

	this.matrix.multiplyMatrices( this.standingMatrix, this.matrix );
	this.matrixWorldNeedsUpdate = true;

};




    /////////////////
   //             //
  //   Vibrate   //
 //             //
/////////////////


THREE.VRController.VIBE_TIME_MAX = 5 * 1000
THREE.VRController.prototype.setVibe = function( name, intensity ){

	if( typeof name === 'number' && intensity === undefined ){

		intensity = name
		name = ''
	}
	if( typeof name === 'string' ){

		const 
		controller = this,
		o = {}


		//  If this channel does not exist yet we must create it,
		//  otherwise we want to remove any future commands 
		//  while careful NOT to delete the 'intensity' property.

		let channel = controller.vibeChannels.find( function( channel ){

			return channel.name === name
		})
		if( channel === undefined ){

			channel = []
			channel.name = name
			channel.intensity = 0
			controller.vibeChannels.push( channel )
		}
		else channel.splice( 0 )


		//  If we received a valid intensity then we should apply it now,
		//  but if not we'll just hold on to the previously reported intensity.
		//  This allows us to reselect a channel and apply a wait() command
		//  before applying an initial set() command!

		if( typeof intensity === 'number' ) channel.intensity = intensity
		else {

			if( typeof channel.intensity === 'number' ) intensity = channel.intensity

			
			//  But if we're SOL then we need to default to zero.

			else intensity = 0
		}

		let cursor = window.performance.now()
		o.set = function( intensity ){

			channel.push([ cursor, intensity ])
			return o
		}
		o.wait = function( duration ){

			cursor += duration
			return o
		}
		return o
	}
}
THREE.VRController.prototype.renderVibes = function(){


	//  First we need to clear away any past-due commands,
	//  and update the current intensity value.

	const 
	now = window.performance.now(),
	controller = this

	controller.vibeChannels.forEach( function( channel ){

		while( channel.length && now > channel[ 0 ][ 0 ]){

			channel.intensity = channel[ 0 ][ 1 ]
			channel.shift()
		}
		if( typeof channel.intensity !== 'number' ) channel.intensity = 0
	})


	//  Now each channel knows its current intensity so we can sum those values.

	const sum = Math.min( 1, Math.max( 0, 

		this.vibeChannels.reduce( function( sum, channel ){

			return sum + +channel.intensity

		}, 0 )
	))
	this.vibeChannels.intensity = sum
	return sum
}
THREE.VRController.prototype.applyVibes = function(){

	if( this.gamepad.hapticActuators && 
		this.gamepad.hapticActuators[ 0 ]){

		const
		renderedIntensity = this.renderVibes(),
		now = window.performance.now()

		if( renderedIntensity !== this.vibeChannels.prior ||
			now - this.vibeChannels.lastCommanded > THREE.VRController.VIBE_TIME_MAX / 2 ){

			this.vibeChannels.lastCommanded = now
			this.gamepad.hapticActuators[ 0 ].pulse( renderedIntensity, THREE.VRController.VIBE_TIME_MAX )
			this.vibeChannels.prior = renderedIntensity
		}
	}
}




    /////////////////
   //             //
  //   Statics   //
 //             //
/////////////////


//  This makes inspecting through the console a little bit saner.
//  Expected values range from 0 (silent) to 1 (everything).

THREE.VRController.verbosity = 0;//0.5


//  We need to keep a record of found controllers
//  and have some connection / disconnection handlers.

THREE.VRController.controllers = [];
THREE.VRController.onGamepadConnect = function( gamepad ) {


	//  Let’s create a new controller object
	//  that’s really an extended THREE.Object3D
	//  and pass it a reference to this gamepad.

	var
		scope = THREE.VRController,
		controller = new scope( gamepad );


	//  We also need to store this reference somewhere so that we have a list
	//  controllers that we know need updating, and by using the gamepad.index
	//  as the key we also know which gamepads have already been found.

	scope.controllers[ gamepad.index ] = controller;


	//  Let’s give the controller a little rumble; some haptic feedback to
	//  let the user know it’s connected and happy.

	var hapticActuators = controller.gamepad.hapticActuators;
	if ( hapticActuators && hapticActuators.length > 0 ) {
		hapticActuators[ 0 ].pulse( 0.1, 300 );
	}


	//  Now we’ll broadcast a global connection event.
	//  We’re not using THREE’s dispatchEvent because this event
	//  is the means of delivering the controller instance.
	//  How would we listen for events on the controller instance
	//  if we don’t already have a reference to it?!

	if( scope.verbosity >= 0.5 ) console.log( 'vr controller connected', controller );
	controller.visible = false;
	window.dispatchEvent( new CustomEvent( 'vr controller connected', { detail: controller }));
};

THREE.VRController.onGamepadDisconnect = function( gamepad, i ) {


	//  We need to find the controller that holds the reference to this gamepad.
	//  Then we can broadcast the disconnection event on the controller itself
	//  and also overwrite our controllers object with undefined. Goodbye!
	//  When you receive this event don’t forget to remove your meshes and whatnot
	//  from your scene so you can either reuse them upon reconnect -- or you
	//  should detroy them. You don’t want memory leaks, right?

	var
		scope = THREE.VRController,
		index = gamepad ? gamepad.index : i,
		controller = scope.controllers[ index ];


	//  Now we can broadcast the disconnection event on the controller itself
	//  and also “delete” from our controllers object. Goodbye!

	if ( scope.verbosity >= 0.5 ) console.log( 'vr controller disconnected', controller );
	controller.dispatchEvent({ type: 'disconnected', controller: controller });
	scope.controllers[ index ] = undefined;


	//  I’ve taken the following out of use because perhaps you want to
	//  fade out your controllers? Or have them fall upwards into the heavens
	//  from whence they came? You don’t want them removed or made invisible
	//  immediately. So just listen for the 'vr controller disconnected' event
	//  and do as you will :)

	//controller.visible = false;
	//controller.parent.remove( controller );
};


//  This is what makes everything so convenient. We keep track of found
//  controllers right here. And by adding this one update function into your
//  animation loop we automagically update all the controller positions,
//  orientations, and button states.
//  Why not just wrap this in its own requestAnimationFrame loop? Performance!
//  https://jsperf.com/single-raf-draw-calls-vs-multiple-raf-draw-calls
//  But also, you will likely be switching between window.requestAnimationFrame
//  which aims for 60fps and vrDisplay.requestAnimationFrame which aims for 90
//  when switching between non-VR and VR rendering. This makes it trivial to
//  make the choices YOU want to.

THREE.VRController.update = function() {

	var gamepads, gamepad, i;


	//  Before we do anything we ought to see if getGamepads even exists.
	// (Perhaps in addition to actual VR rigs you’re also supporting
	//  iOS devices via magic window?) If it doesn’t exist let’s bail:

	if ( navigator.getGamepads === undefined ) return;


	//  Yes, we need to scan the gamepads Array with each update loop
	//  because it is the *safest* way to detect new gamepads / lost gamepads
	//  and we avoid Doob’s proposed problem of a user accidentally including
	//  VRControllers.js multiple times if we were using the 'ongamepadconnected'
	//  and 'ongamepaddisconnected' events firing multiple times.
	//  Also... those connection events are not widely supported yet anyhow.

	gamepads = navigator.getGamepads();
	for ( i = 0; i < gamepads.length; i ++ ) {

		gamepad = gamepads[ i ];
		if ( gamepad !== null && gamepad !== undefined ) {

			if ( this.controllers[ i ] === undefined ) THREE.VRController.onGamepadConnect( gamepad );
			this.controllers[ i ].update();

		} else if ( gamepad === null && this.controllers[ i ] !== undefined ) {


		//  Note: If you power down a gamepad after startup the gamepad will NOT
		//  be null and gamepad.connected will still equal true so this will not fire!!
		//  Instead you’d need to check for gamepad.pose.position === null and
		//  gamepad.pose.orientation === null yourself.

			THREE.VRController.onGamepadDisconnect( gamepad, i );
		}
	}

};

THREE.VRController.inspect = function(){

	THREE.VRController.controllers.forEach( function( controller ){

		console.log( '\n'+ controller.inspect() )
	})
}

// reset so new connected events from different scenes can be fired
THREE.VRController.clear = function() {

	for ( c in this.controllers ) {
		var controller = this.controllers[ c ];
		if ( controller ) {
			var gamepad = this.controllers[ c ].gamepad;
			THREE.VRController.onGamepadDisconnect( gamepad );
		}
	}

};

/**
 * Gets a supported controller schema if a key is found within
 * the id String. TODO: Perhaps worth considering a more "fuzzy"
 * approach to String matching.
 */
THREE.VRController.getSupportedById = function( id ) {

	var keys = THREE.VRController.supportedKeys;

	for ( var i = 0; i < keys.length; i++ ) {
		var key = keys[ i ];
		if ( id.indexOf( key ) >= 0 ) {
			return THREE.VRController.supported[ key ];
		}
	}

	return undefined;

};



    /////////////////
   //             //
  //   Support   //
 //             //
/////////////////


//  Let's take an ID string as reported directly from the Gamepad API,
//  translate that to a more generic "style name" and also see if we can’t map
//  some names to things for convenience. (This stuff was definitely fun to
//  figure out.) These are roughly in order of complexity, simplest first:

THREE.VRController.supported = {

	'Daydream Controller': {

		style: 'daydream',


		//  THUMBPAD
		//  Both a 2D trackpad and a button with both touch and press. 
		//  The Y-axis is "Regular".
		//
		//              Top: Y = -1
		//                   ↑
		//    Left: X = -1 ←─┼─→ Right: X = +1
		//                   ↓
		//           Bottom: Y = +1
		
		axes: [{ name: 'thumbpad', indexes: [ 0, 1 ]}],
		buttons: [ 'thumbpad' ],
		primary: 'thumbpad'
	},

	'OpenVR Gamepad': {

		style: 'vive',


		//  THUMBPAD
		//  Both a 2D trackpad and a button. Its Y-axis is "Goofy" -- in
		//  contrast to Daydream, Oculus, Microsoft, etc.
		//
		//              Top: Y = +1
		//                   ↑
		//    Left: X = -1 ←─┼─→ Right: X = +1
		//                   ↓
		//           Bottom: Y = -1
		//
		//  Vive is the only goofy-footed y-axis in our support lineup so to
		//  make life easier on you WE WILL INVERT ITS AXIS in the code above.
		//  This way YOU don't have to worry about it. 

		axes: [{ name: 'thumbpad', indexes: [ 0, 1 ]}],
		buttons: [


			//  THUMBPAD
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: YES has real touch detection.
			//  isPressed: As expected.

			'thumbpad',


			//  TRIGGER
			//  Has very interesting and distinct behavior on Chromium.
			//  The threshold for releasing a pressed state is higher during
			//  engagement and lower during release.
			//
			//  Chromium
			//  if( value >  0.00 ) isTouched = true else isTouched = false
			//  if( value >= 0.55 ) isPressed = true   UPON ENGAGING
			//  if( value <  0.45 ) isPressed = false  UPON RELEASING
			//
			//  Firefox
			//  if( value >= 0.10 ) isTouched = isPressed = true
			//  if( value <  0.10 ) isTouched = isPressed = false
			//  --------------------------------------------------------------
			//  value:     Analog 0 to 1.
			//  isTouched: Duplicates isPressed in FF, independent in Chrome.
			//  isPressed: Corresponds to value.

			'trigger',


			//  GRIP
			//  Each Vive controller has two grip buttons, one on the left and
			//  one on the right. They are not distinguishable -- pressing 
			//  either one will register as a press with no knowledge of which
			//  one was pressed.
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: Duplicates isPressed.
			//  isPressed: As expected.

			'grip',


			//  MENU
			//  The menu button is the tiny button above the thumbpad -- NOT
			//  the one below it.
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: Duplicates isPressed.
			//  isPressed: As expected.

			'menu'
		],
		primary: 'trigger'
	},

	'Oculus Touch (Right)': {

		style: 'oculus-touch-right',
		//  THUMBSTICK
		//  Oculus's thumbstick has axes values and is also a button.
		//  The Y-axis is "Regular".
		//
		//              Top: Y = -1
		//                   ↑
		//    Left: X = -1 ←─┼─→ Right: X = +1
		//                   ↓
		//           Bottom: Y = +1

		axes: [{ name: 'thumbstick', indexes: [ 0, 1 ]}],
		buttons: [


			//  THUMBSTICK
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: YES has real touch detection.
			//  isPressed: As expected.

			'thumbstick',


			//  TRIGGER
			//  Oculus's trigger in Chromium is far more fire-happy than 
			//  Vive's. Compare these thresholds to Vive's trigger. 
			//
			//  Chromium
			//  if( value >  0.0 ) isTouched = true else isTouched = false
			//  if( value >= 0.1 ) isPressed = true else isPressed = false
			//
			//  Firefox
			//  if( value >= 0.1 ) isTouched = isPressed = true
			//  if( value <  0.1 ) isTouched = isPressed = false
			//  --------------------------------------------------------------
			//  value:     Analog 0 to 1.
			//  isTouched: Duplicates isPressed in FF, independent in Chrome.
			//  isPressed: Corresponds to value.

			'trigger',


			//  GRIP
			//  Oculus's grip button follows the exact same press thresholds
			//  as its trigger.

			'grip',


			//  A B X Y
			//  Oculus has two old-school video game buttons, A and B. (On the
			//  left-hand controller these are X and Y.)
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: YES has real touch detection.
			//  isPressed: As expected.

			'A', 'B',


			//  THUMBREST
			//  Oculus has an inert base "button" that’s really just a resting
			//  place for your thumb. It does NOT report press.
			//  --------------------------------------------------------------
			//  value:     Always 0.
			//  isTouched: YES has real touch detection.
			//  isPressed: N/A.

			'thumbrest'
		],
		primary: 'trigger'
	},
	'Oculus Touch (Left)': {

		style: 'oculus-touch-left',
		axes: [{ name: 'thumbstick', indexes: [ 0, 1 ]}],
		buttons: [

			'thumbstick',
			'trigger',
			'grip',
			'X', 'Y',
			'thumbrest'
		],
		primary: 'trigger'
	},

	//  https://github.com/stewdio/THREE.VRController/issues/8

	'Spatial Controller (Spatial Interaction Source)': {

		style: 'microsoft',
		axes: [


			//  THUMBSTICK
			//  The thumbstick is super twitchy, seems to fire quite a bit on
			//  its own. Its Y-axis is “Regular”.
			//
			//              Top: Y = -1
			//                   ↑
			//    Left: X = -1 ←─┼─→ Right: X = +1
			//                   ↓
			//           Bottom: Y = +1

			{ name: 'thumbstick', indexes: [ 0, 1 ]},


			//  THUMBPAD
			//  Operates exactly the same as the thumbstick but without the
			//  extra twitchiness.

			{ name: 'thumbpad',   indexes: [ 2, 3 ]}
		],
		buttons: [


			//  THUMBSTICK
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: Duplicates isPressed.
			//  isPressed: As expected.

			'thumbstick',


			//  TRIGGER
			//  Its physical range of motion noticably exceeds the range of
			//  values reported. For example when engaging you can continue
			//  to squueze beyond when the value reports 1. And when 
			//  releasing you will reach value === 0 before the trigger is 
			//  completely released. The value property dictates touch and
			//  press states as follows:
			//
			//  Upon engaging
			//  if( value >= 0.00 && value < 0.10 ) NO VALUES REPORTED AT ALL!
			//  if( value >= 0.10 ) isTouched = true
			//  if( value >= 0.12 ) isPressed = true
			//
			//  Upon releasing
			//  if( value <  0.12 ) isPressed = false
			//  if( value == 0.00 ) isTouched = false
			//  --------------------------------------------------------------
			//  value:     Analog 0 to 1.
			//  isTouched: Simulated, corresponds to value.
			//  isPressed: Corresponds to value.

			'trigger',


			//  GRIP
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: Duplicates isPressed.
			//  isPressed: As expected.

			'grip',


			//  MENU
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: Duplicates isPressed.
			//  isPressed: As expected.

			'menu',


			//  THUMBPAD
			//  This is the only button that has actual touch detection.
			//  --------------------------------------------------------------
			//  value:     Binary 0 or 1, duplicates isPressed.
			//  isTouched: YES has real touch detection.
			//  isPressed: As expected.

			'thumbpad'
		],
		primary: 'trigger'

	},

	'Gear VR Controller': {

		style: 'gearvr-controller',
		axes: [{ name: 'thumbpad', indexes: [ 0, 1 ]}],
		buttons: [
			'touchpad',
			'trigger'
		],
		primary: 'touchpad'

	},

	'Gear VR Touchpad': {

		style: 'gearvr-touchpad',
		axes: [{ name: 'thumbpad', indexes: [ 0, 1 ]}],
		buttons: [ 'touchpad' ],
		primary: 'touchpad'

	},

	'Oculus Remote': {

		style: 'oculus-remote',
		buttons: [
			'a',
			'b',
			'd-up',
			'd-down',
			'd-left',
			'd-right'
		],
		primary: 'a'

	},

	'xbox': {

		style: 'xbox',
		axes: [
			{ name: 'thumbstick-left', indexes: [ 0, 1 ]},
			{ name: 'thumbstick-right', indexes: [ 2, 3 ]}
		],
		buttons: [
			'a',
			'b',
			'x',
			'y',
			'bumper-left',
			'bumper-right',
			'trigger-left',
			'trigger-right',
			'select',
			'start',
			'thumbstick-left',
			'thumbstick-right',
			'd-up',
			'd-down',
			'd-left',
			'd-right'
		],
		primary: 'a'
	},

};

THREE.VRController.addSupportedControllers = function() {

	var xids = [
		'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
		'Xbox One Wired Controller (STANDARD GAMEPAD Vendor: 045e Product: 02dd)',
		'xinput'
	];

	for ( var i = 0; i < xids.length; i++ ) {

		var id = xids[ i ];
		THREE.VRController.supported[ id ] = THREE.VRController.supported.xbox;

	}

};

THREE.VRController.addSupportedControllers();
THREE.VRController.supportedKeys = Object.keys( THREE.VRController.supported );








    ///////////////////
   //               //
  //   Arm Model   //
 //               //
///////////////////


//  Adapted from Boris’ code in a hurry -- many thanks, Mr. Smus!
//  Represents the arm model for the Daydream controller.
//  Feed it a camera and the controller. Update it on a RAF.
//  Get the model's pose using getPose().

function OrientationArmModel() {

	this.isLeftHanded = false;


	//  Current and previous controller orientations.

	this.controllerQ     = new THREE.Quaternion();
	this.lastControllerQ = new THREE.Quaternion();


	//  Current and previous head orientations.

	this.headQ = new THREE.Quaternion();


	//  Current head position.

	this.headPos = new THREE.Vector3();


	//  Positions of other joints (mostly for debugging).

	this.elbowPos = new THREE.Vector3();
	this.wristPos = new THREE.Vector3();


	//  Current and previous times the model was updated.

	this.time     = null;
	this.lastTime = null;


	//  Root rotation.

	this.rootQ = new THREE.Quaternion();


	//  Current pose that this arm model calculates.

	this.pose = {
		orientation: new THREE.Quaternion(),
		position:    new THREE.Vector3()
	};

};


//  STATICS.

Object.assign( OrientationArmModel, {
	HEAD_ELBOW_OFFSET       : new THREE.Vector3(  0.155, -0.465, -0.15 ),
	ELBOW_WRIST_OFFSET      : new THREE.Vector3(  0, 0, -0.25 ),
	WRIST_CONTROLLER_OFFSET : new THREE.Vector3(  0, 0, 0.05 ),
	ARM_EXTENSION_OFFSET    : new THREE.Vector3( -0.08, 0.14, 0.08 ),
	ELBOW_BEND_RATIO        : 0.4,//  40% elbow, 60% wrist.
	EXTENSION_RATIO_WEIGHT  : 0.4,
	MIN_ANGULAR_SPEED       : 0.61//  35˚ per second, converted to radians.
});


//  SETTERS.
//  Methods to set controller and head pose (in world coordinates).

OrientationArmModel.prototype.setControllerOrientation = function( quaternion ) {

	this.lastControllerQ.copy( this.controllerQ );
	this.controllerQ.copy( quaternion );

};
OrientationArmModel.prototype.setHeadOrientation = function( quaternion ) {

	this.headQ.copy( quaternion );

};
OrientationArmModel.prototype.setHeadPosition = function( position ) {

	this.headPos.copy( position );

};
OrientationArmModel.prototype.setLeftHanded = function( isLeftHanded ) {//  TODO(smus): Implement me!

	this.isLeftHanded = isLeftHanded;

};


/**
 * Called on a RAF.
 */
OrientationArmModel.prototype.update = function() {

	this.time = performance.now();


	//  If the controller’s angular velocity is above a certain amount,
	//  we can assume torso rotation and move the elbow joint relative
	//  to the camera orientation.

	var
		headYawQ = this.getHeadYawOrientation_(),
		timeDelta = ( this.time - this.lastTime ) / 1000,
		angleDelta = this.quatAngle_( this.lastControllerQ, this.controllerQ ),
		controllerAngularSpeed = angleDelta / timeDelta;

	if ( controllerAngularSpeed > OrientationArmModel.MIN_ANGULAR_SPEED ) {
		this.rootQ.slerp( headYawQ, angleDelta / 10 );	// Attenuate the Root rotation slightly.
	} else {
		this.rootQ.copy( headYawQ );
	}


	// We want to move the elbow up and to the center as the user points the
	// controller upwards, so that they can easily see the controller and its
	// tool tips.
	var controllerEuler = new THREE.Euler().setFromQuaternion( this.controllerQ, 'YXZ' );
	var controllerXDeg = THREE.Math.radToDeg( controllerEuler.x );
	var extensionRatio = this.clamp_( ( controllerXDeg - 11 ) / ( 50 - 11 ), 0, 1 );

	// Controller orientation in camera space.
	var controllerCameraQ = this.rootQ.clone().inverse();
	controllerCameraQ.multiply( this.controllerQ );

	// Calculate elbow position.
	var elbowPos = this.elbowPos;
	elbowPos.copy( this.headPos ).add( OrientationArmModel.HEAD_ELBOW_OFFSET );
	var elbowOffset = new THREE.Vector3().copy( OrientationArmModel.ARM_EXTENSION_OFFSET );
	elbowOffset.multiplyScalar( extensionRatio );
	elbowPos.add( elbowOffset );

	// Calculate joint angles. Generally 40% of rotation applied to elbow, 60%
	// to wrist, but if controller is raised higher, more rotation comes from
	// the wrist.
	var totalAngle = this.quatAngle_( controllerCameraQ, new THREE.Quaternion() );
	var totalAngleDeg = THREE.Math.radToDeg( totalAngle );
	var lerpSuppression = 1 - Math.pow( totalAngleDeg / 180, 4 ); // TODO(smus): ???

	var elbowRatio = OrientationArmModel.ELBOW_BEND_RATIO;
	var wristRatio = 1 - OrientationArmModel.ELBOW_BEND_RATIO;
	var lerpValue = lerpSuppression *
			( elbowRatio + wristRatio * extensionRatio * OrientationArmModel.EXTENSION_RATIO_WEIGHT );

	var wristQ = new THREE.Quaternion().slerp( controllerCameraQ, lerpValue );
	var invWristQ = wristQ.inverse();
	var elbowQ = controllerCameraQ.clone().multiply( invWristQ );

	// Calculate our final controller position based on all our joint rotations
	// and lengths.
	/*
	position_ =
		root_rot_ * (
			controller_root_offset_ +
2:      (arm_extension_ * amt_extension) +
1:      elbow_rot * (kControllerForearm + (wrist_rot * kControllerPosition))
		);
	*/
	var wristPos = this.wristPos;
	wristPos.copy( OrientationArmModel.WRIST_CONTROLLER_OFFSET );
	wristPos.applyQuaternion( wristQ );
	wristPos.add( OrientationArmModel.ELBOW_WRIST_OFFSET );
	wristPos.applyQuaternion( elbowQ );
	wristPos.add( this.elbowPos );

	var offset = new THREE.Vector3().copy( OrientationArmModel.ARM_EXTENSION_OFFSET );
	offset.multiplyScalar( extensionRatio );

	var position = new THREE.Vector3().copy( this.wristPos );
	position.add( offset );
	position.applyQuaternion( this.rootQ );

	var orientation = new THREE.Quaternion().copy( this.controllerQ );


	//  Set the resulting pose orientation and position.

	this.pose.orientation.copy( orientation );
	this.pose.position.copy( position );

	this.lastTime = this.time;
};




//  GETTERS.
//  Returns the pose calculated by the model.

OrientationArmModel.prototype.getPose = function() {

	return this.pose;

};


//  Debug methods for rendering the arm model.

OrientationArmModel.prototype.getForearmLength = function() {

	return OrientationArmModel.ELBOW_WRIST_OFFSET.length();

};
OrientationArmModel.prototype.getElbowPosition = function() {

	var out = this.elbowPos.clone();
	return out.applyQuaternion( this.rootQ );

};
OrientationArmModel.prototype.getWristPosition = function() {

	var out = this.wristPos.clone();
	return out.applyQuaternion( this.rootQ );

};
OrientationArmModel.prototype.getHeadYawOrientation_ = function() {

	var
		headEuler = new THREE.Euler().setFromQuaternion( this.headQ, 'YXZ' ),
		destinationQ;

	headEuler.x  = 0;
	headEuler.z  = 0;
	destinationQ = new THREE.Quaternion().setFromEuler( headEuler );
	return destinationQ;

};


//  General tools...

OrientationArmModel.prototype.clamp_ = function( value, min, max ) {

	return Math.min( Math.max( value, min ), max );

};
OrientationArmModel.prototype.quatAngle_ = function( q1, q2 ) {

	var
		vec1 = new THREE.Vector3( 0, 0, -1 ),
		vec2 = new THREE.Vector3( 0, 0, -1 );

	vec1.applyQuaternion( q1 );
	vec2.applyQuaternion( q2 );
	return vec1.angleTo( vec2 );

};
