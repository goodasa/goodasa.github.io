# Deep Learning in 11 Lines of MATLAB Code

### Sources

01 [Video](https://jp.mathworks.com/videos/deep-learning-in-11-lines-of-matlab-code-1481229977318.html)

02 [File Exchange](<https://jp.mathworks.com/matlabcentral/fileexchange/60659-deep-learning-in-11-lines-of-matlab-code>) 

---

### Prerequisite

01 AlexNet:

a pretrained deep convolutional neural network (CNN or ConvNet) that has been trained on over a million images



---

### Steps

> Through Add-on manager, the webcam support package will be installed. 
>
> Log-in process is required to access Add-on manager.

#### 01 Download webcam support package

<https://www.mathworks.com/matlabcentral/fileexchange/45182-matlab-support-package-for-usb-webcams>

```
$ camList = webcamlist

$ % Connect to the webcam.
cam = webcam(1)

$ preview(cam);

$ img = snapshot(cam);

% Display the frame in a figure window.
image(img);

$ for idx = 1:5
    img = snapshot(cam);
    image(img);
end

$ clear cam
```



#### 02 Download AlexNet support package

<https://jp.mathworks.com/matlabcentral/fileexchange/59133-deep-learning-toolbox-model-for-alexnet-network>



#### 03 webcam_object_classification.m 실행

```
% Copyright 2016 The MathWorks, Inc.

clear

camera = webcam; % Connect to the camera
nnet = alexnet;  % Load the neural net

while true   
    picture = camera.snapshot;              % Take a picture    
    picture = imresize(picture,[227,227]);  % Resize the picture

    label = classify(nnet, picture);        % Classify the picture
       
    image(picture);     % Show the picture
    title(char(label)); % Show the label
    drawnow;   
end
```

