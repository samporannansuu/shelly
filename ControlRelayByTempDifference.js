let tubeSensor = 100;
let outSensor = 101
let outTemp = 0.0;prevOutTemp=0.0;
let tubeTemp= 0.0; prevTubeTemp=0.0;
let tubeTempLowerThan = 13; outTempHigherThan = 20

let heatingTimeInHours= 2;
let heatingIntervalHours= 8;
let heatingStarted = new Date(), heatingStopTime = new Date(), nextPossibleHeatingTime=new Date();
let shouldContinue = false;

let isHeating = false;

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getTemperatures()
{
  try{
      outTemp = Shelly.getComponentStatus('Temperature', tubeSensor).tC;  
      tubeTemp = Shelly.getComponentStatus('Temperature', outSensor).tC;  
      
      print(tubeTemp + " " + outTemp);
      prevOutTemp = outTemp;
      prevTubeTemp = tubeTemp;
  }catch(e){
    print(e);
    outTemp = prevOutTemp;
    tubeTemp = prevTubeTemp;
  }

}

function shouldStillRun()
{ 
  let now = new Date();
  if( now > heatingStopTime )
  {
      return false;
  }
  return true;      
}

function canStartHeatingByTime()
{ 
  let now = new Date();
  if(now > nextPossibleHeatingTime)
  {
    return true;
  }  
  return false; 
}

function canStartHeatingByTempDifference()
{ 
   if(tubeTemp < tubeTempLowerThan && outTemp > outTempHigherThan){
      return true;
   }
   
   return false;
}

print("Starting, setting switch initial state to off");
Shelly.call("Switch.Set", "{ id:" + 0 + ", on:" + isHeating + "}", null, null);

Timer.set(30000, true, function() {
  getTemperatures();
  print("Now:" + new Date().toString())  
  print("TubeTemp:" + tubeTemp);
  print("OutTemp:" + outTemp);
  print("IsHeating: " + isHeating);
  print("HeatingStop: " + heatingStopTime.toString());
  print("NextPossibleHeatTIme: " + nextPossibleHeatingTime.toString()); 

  if(isHeating && shouldStillRun())
  {
    print("Heating is on and should continue");
    return;
  }
  else if (isHeating){
    print("Heating is on and should stop");
    isHeating = false;
    Shelly.call("Switch.Set", "{ id:" + 0 + ", on:" + isHeating + "}", null, null);
  }  
  if (canStartHeatingByTempDifference() && canStartHeatingByTime())
  {     
      isHeating = true;
      Shelly.call("Switch.Set", "{ id:" + 0 + ", on:" + isHeating + "}", null, null);
      heatingStopTime = addHours(new Date(), heatingTimeInHours);
      nextPossibleHeatingTime = addHours(heatingStopTime,heatingIntervalHours);
                
      print("Heating started, new stopTime: " + heatingStopTime.toString());
      print("Heating started, new NextPossibleStart: " + nextPossibleHeatingTime.toString());
  }
  
});