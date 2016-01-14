;( function() {
	
	"use strict";

	var App = require( "./../../../namespaces.js" );

	App.Views.Chart.Map.Legend = function() {

		//private
		var stepSize = 20,
			stepClass = "legend-step",
			legendOffsetX = 10,
			legendOffsetY = 60,
			stepGap = 2,
			displayMinLabel = true,
			labels = [], 
			orientation = "landscape",
			scale, minData, maxData, datamap, container, containerHeight, isOrdinalScale, descriptionHeight, g, gDesc;

		var formatLegendLabel = function( valueArr, i, length ) {
			
			valueArr = valueArr.map( function( d ) {
				//make sure it's not undefined
				if( d ) {
					var len = d.toString().length,
						formattedNumber = d;
					if( len > 3 ) {
						formattedNumber = d3.format( ".3r" )( d );
					}
				} else {
					//see if we're suppose to display minimal value
					if( displayMinLabel ) {
						formattedNumber = ( minData )? minData: 0;
					}
				}
				return formattedNumber;
			} );
			if( i < (length - 1) ) {
				return valueArr[ 0 ];
			} else {
				//need to use tspan with preserve to have the whitespcae
				return "<tspan class='last-label-tspan'>" + valueArr[ 0 ] + "</tspan><tspan class='last-label-tspan'>" + valueArr[ 1 ] + "</tspan>";
			}

		};

		var formatOrdinalLegendLabel = function( i, scale ) {
			return scale.domain()[ i ];
		};

		var resize = function() {
			//check legend is constructed already
			if( g ) {
				//refresh container height
				containerHeight = datamap.node().getBoundingClientRect().height;
				//position legend vertically
				var legendY = containerHeight - legendOffsetY - stepSize;
				if( orientation === "landscape" ) {
					legendY -= descriptionHeight;
				}
				container.attr( "transform", "translate(0," + legendY + ")" );
			}
		};

		function legend( selection ) {

			selection.each( function( data ) {
				
				datamap = d3.select( ".datamap" );
				container = d3.select( this );
				isOrdinalScale = ( !scale || !scale.hasOwnProperty( "invertExtent" ) )? true: false;
				descriptionHeight = ( data.description && data.description.length )? 12: 0;
				g = container.select( ".legend" );

				if( g.empty() ) {
					g = selection.append( "g" )
							.attr( "id", "legend" )
							.attr( "class", "legend" );
				}
				
				//start with highest value
				//data.reverse();

				//data join
				var legendSteps = g.selectAll( "." + stepClass ).data( data.scheme );
				
				//enter
				var legendStepsEnter = legendSteps.enter()
					.append( "g" )
						.attr( "class", stepClass );
				legendStepsEnter.append( "rect" );
				legendStepsEnter.append( "line" );
				legendStepsEnter.append( "text" );

				//vars for landscape
				var maxDataIndex = data.scheme.length - 1,
					legendStepsOffsetX = legendOffsetX;
				if( orientation === "portrait" && data.description ) {
					legendStepsOffsetX += 5;
				}
				
				//update
				legendSteps
					.attr( "transform", function( d, i ) { var translateX = ( orientation === "landscape" )? legendStepsOffsetX + (i*(stepSize+stepGap)): legendStepsOffsetX, translateY = ( orientation === "landscape" )? 0: ( -( maxDataIndex - i ) * ( stepSize + stepGap ) ); return "translate(" + translateX + "," + translateY + ")"; } );
				legendSteps.selectAll( "rect" )
					.attr( "width", stepSize + "px" )
					.attr( "height", stepSize + "px" );
				/*legendSteps.selectAll( "line" )
					.attr( "x1", 0 ).attr( "y1", -5 )
					.attr( "x2", 0 ).attr( "y2", stepSize+5 );*/
				legendSteps.select( "rect" )
					.style( "fill", function( d, i ) {
							return d;
						} );
				legendSteps.selectAll( "text" ).attr( "transform", function( d, i ) { var stepSizeX = stepSize/2 + 4; return ( orientation === "portrait" )? "translate(" + (stepSize+5) + "," + (stepSize/2+3) + ")": ( !isOrdinalScale && !labels.length )? "translate(-2,-5)": "translate(" + stepSizeX + ",-5) rotate(270)"; } );

				//is there custom labeling for 
				var legendStepsTexts = legendSteps.select( "text" )
							.html( function( d, i ) { return ( labels && labels[ i ] )? labels[ i ]: ( !isOrdinalScale )? formatLegendLabel( scale.invertExtent( d ), i, data.scheme.length ): formatOrdinalLegendLabel( i, scale ) ; } );
				
				//position last tspans
				var legendStepsTspans = legendStepsTexts.selectAll( "tspan.last-label-tspan" ),
					firstTspanLength = 0;
				legendStepsTspans.each( function( d, i ) {
					if( i === 0 ) {
						firstTspanLength = this.getComputedTextLength();
					} else {
						var dx = stepSize - firstTspanLength;
						d3.select( this ).attr( "dx", dx );
					}
				} );
				
				//exit
				legendSteps.exit().remove();

				//legend description
				gDesc = container.selectAll( ".legend-description" ).data( [data.description] );
				gDesc.enter()
					.append( "text" )
					.attr( "class", "legend-description" );
				gDesc
					.text( data.description );
				gDesc.attr( "transform", function( d, i ) { var translateX = legendOffsetX, translateY = ( orientation === "landscape" )? stepSize+descriptionHeight: stepSize; return ( orientation === "landscape" )? "translate(" + translateX + "," + translateY + ")": "translate(" + translateX + "," + translateY + ") rotate(270)"; } );

				//position legend vertically
				resize();

			} );

			return legend;

		}

		legend.resize = resize;

		//public methods
		legend.stepSize = function( value ) {
			if( !arguments.length ) {
				return stepSize;
			} else {
				stepSize = parseInt( value, 10);
			}
		};
		legend.scale = function( value ) {
			if( !arguments.length ) {
				return scale;
			} else {
				scale = value;
			}
		};
		legend.minData = function( value ) {
			if( !arguments.length ) {
				return minData;
			} else {
				minData = value;
			}
		};
		legend.maxData = function( value ) {
			if( !arguments.length ) {
				return maxData;
			} else {
				maxData = value;
			}
		};
		legend.displayMinLabel = function( value ) {
			if( !arguments.length ) {
				return displayMinLabel;
			} else {
				displayMinLabel = value;
			}
		};
		legend.labels = function( value ) {
			if( !arguments.length ) {
				return labels;
			} else {
				//set sensible default
				if( !value ) {
					value = [];
				}
				labels = value;
			}
		};
		legend.orientation = function( value ) {
			if( !arguments.length ) {
				return orientation;
			} else {
				orientation = value;
			}
		};

		return legend;

	};

	module.exports = App.Views.Chart.Map.Legend;

})();