# Football Action Classification with Swin Transformer - Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Configuration](#configuration)
4. [Data Processing](#data-processing)
5. [Model Components](#model-components)
6. [Training Pipeline](#training-pipeline)
7. [Evaluation & Visualization](#evaluation--visualization)
8. [Technical Implementation Details](#technical-implementation-details)

---

## Overview

### Project Description
This project implements an advanced deep learning system for classifying football actions in videos. It uses a **Swin Small Transformer** as the backbone combined with sophisticated temporal modeling techniques to recognize five types of football events:
- Foul
- Goal
- Free kick
- Penalty
- Corner

### Key Features
- **Backbone**: Swin Small Transformer (patch4_window7_224)
- **Temporal Modeling**: Multi-scale context-aware processing with LSTM and attention mechanisms
- **Memory Optimization**: Designed for Kaggle Tesla P100 (16GB GPU)
- **Advanced Training**: Mixup augmentation, focal loss, gradient accumulation, mixed precision

### Hardware Requirements
- **GPU**: Tesla P100 or equivalent (16GB VRAM)
- **Memory Management**: Aggressive caching and garbage collection
- **CUDA**: Required for optimal performance

---

## Configuration

### Global Configuration Parameters

```python
CONFIG = {
    # Data
    'data_path': '/kaggle/input/highlights',
    'num_classes': 5,
    'videos_per_class': 300,
    
    # Model Architecture
    'model_name': 'swin_small_patch4_window7_224',
    'num_frames': 60,
    'img_size': 224,
    'dropout': 0.4,
    'temporal_attention_heads': 8,
    'lstm_layers': 2,
    'hidden_multiplier': 2,
    
    # Training
    'batch_size': 2,
    'gradient_accumulation_steps': 16,
    'num_epochs': 10,
    'learning_rate': 4e-5,
    'weight_decay': 0.015,
    'warmup_ratio': 0.12,
    
    # Optimization
    'mixed_precision': True,
    'gradient_clipping': 1.2,
    'freeze_backbone_epochs': 2,
    
    # Regularization
    'label_smoothing': 0.12,
    'focal_loss_gamma': 2.0,
    'focal_loss_alpha': 0.7,
    'mixup_alpha': 0.25,
    
    # System
    'num_workers': 2,
    'early_stopping_patience': 5,
    'save_path': 'best_swin_small_model.pth'
}
```

### Configuration Rationale

| Parameter | Value | Reason |
|-----------|-------|--------|
| `batch_size: 2` | Small batch | Memory constraints with 60 frames per video |
| `gradient_accumulation_steps: 16` | 16 steps | Effective batch size = 32 (2×16) |
| `num_frames: 60` | 60 frames | Balance between temporal coverage and memory |
| `dropout: 0.4` | High dropout | Prevent overfitting on limited data |
| `freeze_backbone_epochs: 2` | 2 epochs | Fine-tune gradually to prevent catastrophic forgetting |

---

## Data Processing

### 1. Data Loading Function

```python
def load_data(data_path, videos_per_class)
```

**Purpose**: Load and balance video dataset across all classes

**Process**:
1. Scans each class directory (foul, goal, freekick, penalty, corner)
2. Balances dataset by selecting fixed number of videos per class
3. If class has fewer videos than required, performs oversampling with replacement
4. Creates label mapping: class name → integer index

**Returns**:
- `video_paths`: List of full paths to video files
- `labels`: Corresponding integer labels
- `classes`: Class names in order

**Key Features**:
- Handles imbalanced datasets through sampling
- Supports multiple video formats (.mp4, .avi, .mov)
- Provides detailed logging of data statistics

---

### 2. AdvancedVideoDataset Class

```python
class AdvancedVideoDataset(Dataset)
```

#### Initialization Parameters
- `video_paths`: List of video file paths
- `labels`: Corresponding labels
- `num_frames`: Number of frames to extract (default: 60)
- `img_size`: Target image size (default: 224)
- `mode`: 'train' or 'val' for different augmentation strategies

#### Data Augmentation Strategy

**Training Mode Augmentations**:
1. **Spatial Augmentations**:
   - RandomResizedCrop: scale=(0.75, 1.0), ratio=(0.85, 1.15)
   - RandomHorizontalFlip: p=0.5
   - RandomRotation: ±12 degrees
   - ColorJitter: brightness, contrast, saturation (0.3), hue (0.15)
   - RandomGrayscale: p=0.12
   - GaussianBlur: p=0.15, sigma=(0.1, 2.0)

2. **Temporal Augmentations**:
   - Random temporal jittering within segments
   - 35% jitter range around segment centers

**Validation Mode**:
- Simple resize to target dimensions
- Uniform temporal sampling
- No augmentation (for consistent evaluation)

#### Frame Extraction Method

```python
def extract_frames(self, video_path)
```

**Intelligent Frame Sampling**:

1. **Short Videos** (< num_frames):
   - Extract all available frames
   - Tile frames to reach target count

2. **Long Videos** (≥ num_frames):
   - **Training**: Random temporal window with jittering
     - Divide video into num_frames segments
     - Sample randomly within each segment with ±35% jitter
   - **Validation**: Uniform sampling
     - Evenly spaced frames across video duration

3. **Error Handling**:
   - Replicate last valid frame if read fails
   - Handle edge cases (empty videos, corrupted files)

**Output**: List of 60 RGB frames, each 224×224 pixels

---

## Model Components

### 1. AdaptiveFocalLoss

```python
class AdaptiveFocalLoss(nn.Module)
```

**Purpose**: Address class imbalance and focus on hard examples

**Formula**:
```
FL(pt) = -α(1 - pt)^γ × CE(pt)
```

**Parameters**:
- `alpha` (0.7): Weighting factor for class balance
- `gamma` (2.0): Focusing parameter (higher = more focus on hard examples)
- `label_smoothing` (0.12): Prevents overconfidence

**Advantages**:
- Down-weights easy examples (high pt)
- Focuses learning on misclassified samples
- Reduces overfitting through label smoothing

---

### 2. ContextAwareTemporalModule

```python
class ContextAwareTemporalModule(nn.Module)
```

**Purpose**: Multi-scale temporal feature extraction

**Architecture**:
```
Input: (batch, num_frames, feature_dim)
    ↓
[Pyramid Conv Layers]
├─ Conv1D (kernel=3)  → 1/4 features
├─ Conv1D (kernel=5)  → 1/4 features
├─ Conv1D (kernel=7)  → 1/4 features
└─ Conv1D (kernel=11) → 1/4 features
    ↓
Concatenate → Fusion Conv → Output
```

**Key Concepts**:
- **Temporal Pyramid**: Captures patterns at different time scales
  - kernel=3: Local motion (3 frames ≈ 0.1s)
  - kernel=5: Short actions (5 frames ≈ 0.17s)
  - kernel=7: Medium events (7 frames ≈ 0.23s)
  - kernel=11: Long patterns (11 frames ≈ 0.37s)
- **Parallel Processing**: All scales computed simultaneously
- **Feature Fusion**: Combines multi-scale information

**Output**: Enhanced temporal features with multi-scale context

---

### 3. EnhancedSwinSmallTransformer

```python
class EnhancedSwinSmallTransformer(nn.Module)
```

#### Architecture Overview

```
Video Input (B, 60, 3, 224, 224)
    ↓
┌─────────────────────────────────┐
│  Swin Small Backbone            │
│  (Spatial Feature Extraction)   │
└─────────────────────────────────┘
    ↓ (B, 60, feature_dim)
┌─────────────────────────────────┐
│  Context-Aware Temporal Module  │
│  (Multi-scale Temporal Context) │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Temporal Conv Layers           │
│  (Local Temporal Patterns)      │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Bidirectional LSTM             │
│  (Sequential Dependencies)      │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Multi-Head Self-Attention      │
│  (Global Temporal Relations)    │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Frame Importance Weighting     │
│  (Adaptive Frame Selection)     │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Temporal Pooling               │
│  (Hybrid Avg + Max)             │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Deep Classifier                │
│  (4-layer MLP)                  │
└─────────────────────────────────┘
    ↓
Output Logits (B, 5)
```

#### Component Details

##### A. Swin Small Backbone
- **Pre-trained**: ImageNet-21k weights
- **Feature Dimension**: 768
- **Gradient Checkpointing**: Enabled for memory efficiency
- **Processing**: Extracts spatial features from each frame independently

##### B. Temporal Convolution
```python
Sequential(
    Conv1d(768, 768, kernel=3, padding=1),
    BatchNorm1d, GELU, Dropout(0.2),
    Conv1d(768, 768, kernel=3, padding=1),
    BatchNorm1d, GELU
)
```
- Captures local temporal dependencies
- Preserves feature dimensionality

##### C. Bidirectional LSTM
- **Configuration**: 
  - 2 layers
  - Hidden size: 384 (feature_dim // 2)
  - Bidirectional: processes forward and backward
- **Purpose**: Model long-range temporal dependencies
- **Output**: Contextual features with past and future information

##### D. Multi-Head Self-Attention
- **Heads**: 8 (auto-adjusted if feature_dim not divisible)
- **Mechanism**: 
  - Query, Key, Value all from LSTM output
  - Learns which frames are related
- **Benefits**: Global temporal reasoning, attention to key moments

##### E. Frame Importance Weighting
```python
Sequential(
    Linear(768, 192),
    GELU, Dropout(0.2),
    Linear(192, 1),
    Sigmoid  # Outputs weight ∈ [0, 1] per frame
)
```
- **Purpose**: Learn to weight important frames higher
- **Application**: Multiply features element-wise
- **Effect**: Focus on action-relevant frames (e.g., moment of goal)

##### F. Hybrid Temporal Pooling
```python
avg_pool = weighted_features.mean(dim=1)
max_pool = weighted_features.max(dim=1)
video_features = avg_pool + 0.3 * max_pool
```
- **Average Pooling**: Captures overall temporal information
- **Max Pooling**: Highlights peak activations
- **Combination**: Balances global and salient features

##### G. Deep Classifier
```python
Sequential(
    LayerNorm(768),
    Dropout(0.4),
    Linear(768, 1536),      # 2× expansion
    GELU, Dropout(0.28),
    Linear(1536, 768),
    GELU, Dropout(0.24),
    Linear(768, 384),
    GELU, Dropout(0.16),
    Linear(384, 5)          # 5 classes
)
```
- **4-layer MLP**: Deep non-linear transformation
- **Progressive dropout**: Higher at earlier layers
- **Feature compression**: 768 → 1536 → 768 → 384 → 5

---

### 4. Mixup Data Augmentation

```python
def mixup_data(x, y, alpha=0.25)
```

**Purpose**: Create virtual training examples through interpolation

**Process**:
1. Sample mixing coefficient: λ ~ Beta(α, α)
2. Randomly shuffle batch indices
3. Create mixed inputs: x_mixed = λ·x + (1-λ)·x_shuffled
4. Create soft targets: both original and shuffled labels

**Benefits**:
- Regularization through smooth decision boundaries
- Reduces memorization
- Improves generalization

**Usage**: Applied with 40% probability during training

---

## Training Pipeline

### 1. Optimizer Configuration

```python
optimizer = torch.optim.AdamW([
    {'params': backbone, 'lr': lr * 0.1},           # Lower LR for pre-trained
    {'params': context_temporal, 'lr': lr},
    {'params': temporal_conv, 'lr': lr},
    {'params': lstm, 'lr': lr},
    {'params': temporal_attention, 'lr': lr},
    {'params': frame_weights, 'lr': lr * 1.5},     # Higher for new layers
    {'params': classifier, 'lr': lr * 2}           # Highest for classifier
], weight_decay=0.015)
```

**Rationale**:
- **Discriminative Learning Rates**: Different rates for different layers
- **Lower for Backbone**: Pre-trained features need gentle fine-tuning
- **Higher for Classifier**: New randomly initialized layers need faster learning
- **Weight Decay**: L2 regularization to prevent overfitting

---

### 2. Learning Rate Scheduling

```python
scheduler = OneCycleLR(
    optimizer,
    max_lr=[lr*0.1, lr, lr, lr, lr, lr*1.5, lr*2],
    total_steps=total_steps,
    pct_start=0.12,         # 12% warmup
    anneal_strategy='cos',  # Cosine annealing
    div_factor=25,          # Initial LR = max_lr / 25
    final_div_factor=1000   # Final LR = max_lr / 1000
)
```

**OneCycleLR Strategy**:
```
LR
 ^
 │     /\
 │    /  \
 │   /    \___
 │  /         \___
 │ /              \___
 └──────────────────────> Steps
   Warmup  Peak  Anneal
   (12%)  (38%)  (50%)
```

**Benefits**:
- **Warmup**: Prevents instability in early training
- **Peak**: Enables fast learning in middle epochs
- **Annealing**: Fine-tunes weights at the end

---

### 3. Training Loop

```python
def train_epoch(model, dataloader, criterion, optimizer, 
                scheduler, device, scaler, accum_steps, epoch)
```

#### Key Training Features

##### A. Dynamic Backbone Freezing
```python
if epoch < freeze_backbone_epochs:
    freeze(backbone)  # Epochs 0-1: freeze
else:
    unfreeze(backbone)  # Epochs 2+: fine-tune
```
**Purpose**: Prevent catastrophic forgetting of pre-trained features

##### B. Gradient Accumulation
```python
effective_batch_size = batch_size * accumulation_steps
# 2 × 16 = 32 effective batch size
```
**Process**:
1. Forward pass on small batch (batch_size=2)
2. Backward pass but don't update weights
3. Repeat for accumulation_steps (16 times)
4. Single optimizer step with accumulated gradients

**Benefits**:
- Simulates large batch training
- Fits in limited GPU memory
- More stable gradient estimates

##### C. Mixed Precision Training
```python
with torch.amp.autocast('cuda'):
    outputs = model(videos)
    loss = criterion(outputs, labels)

scaler.scale(loss).backward()
scaler.step(optimizer)
scaler.update()
```
**Process**:
- Forward pass in FP16 (faster, less memory)
- Loss scaling prevents underflow
- Gradients in FP32 (stable updates)

**Benefits**:
- ~2× faster training
- ~50% memory reduction
- Minimal accuracy loss

##### D. Gradient Clipping
```python
torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.2)
```
**Purpose**: Prevent exploding gradients in deep networks

---

### 4. Validation Loop

```python
def validate(model, dataloader, criterion, device)
```

**Process**:
1. Set model to evaluation mode (`model.eval()`)
2. Disable gradient computation (`torch.no_grad()`)
3. Forward pass on all validation samples
4. Compute loss and accuracy
5. Collect predictions for detailed analysis

**Returns**:
- Average validation loss
- Validation accuracy
- All predictions (for confusion matrix)
- All ground truth labels

---

### 5. Early Stopping

**Logic**:
```python
if val_acc > best_acc:
    save_model()
    early_stop_counter = 0
else:
    early_stop_counter += 1
    if early_stop_counter >= patience:
        stop_training()
```

**Parameters**:
- `patience = 5`: Stop if no improvement for 5 consecutive epochs
- Saves best model checkpoint

**Benefits**:
- Prevents overfitting
- Saves training time
- Automatically finds optimal stopping point

---

## Evaluation & Visualization

### 1. Classification Report

Generated using `sklearn.metrics.classification_report`:

**Metrics per Class**:
- **Precision**: TP / (TP + FP) - accuracy of positive predictions
- **Recall**: TP / (TP + FN) - coverage of actual positives
- **F1-Score**: 2 × (Precision × Recall) / (Precision + Recall) - harmonic mean
- **Support**: Number of samples in each class

**Example Output**:
```
              precision    recall  f1-score   support
        foul     0.8500    0.8200    0.8347        60
        goal     0.9200    0.9500    0.9348        60
    freekick     0.7800    0.7500    0.7647        60
     penalty     0.9000    0.8800    0.8899        60
      corner     0.8400    0.8700    0.8547        60
```

---

### 2. Confusion Matrix

```python
cm = confusion_matrix(true_labels, predicted_labels)
```

**Two Visualizations**:

1. **Count Matrix**: Shows absolute number of predictions
   - Diagonal: Correct predictions
   - Off-diagonal: Misclassifications

2. **Normalized Matrix**: Shows percentages per class
   - Each row sums to 100%
   - Reveals which classes are confused

**Example**:
```
           foul  goal  freekick  penalty  corner
foul        49     2      5         2        2
goal         1    57      1         1        0
freekick     4     1     45         5        5
penalty      2     1      4        53        0
corner       1     0      3         1       55
```

---

### 3. Training Curves Visualization

```python
def plot_results(history, cm, classes)
```

**Four Subplots**:

1. **Loss Curves**:
   - Train loss (blue line)
   - Validation loss (red line)
   - Shows convergence and overfitting

2. **Accuracy Curves**:
   - Train accuracy (blue line)
   - Validation accuracy (red line)
   - Tracks performance improvement

3. **Confusion Matrix (Counts)**:
   - Heatmap with actual prediction counts
   - Darker = more predictions

4. **Confusion Matrix (Normalized)**:
   - Percentage-based heatmap
   - Shows class-wise performance

**Output**: High-resolution PNG (300 DPI) saved as `training_results.png`

---

## Technical Implementation Details

### 1. Memory Management

#### A. Memory Clearing Strategy
```python
def clear_memory():
    torch.cuda.empty_cache()
    gc.collect()
```

**Called After**:
- Each training epoch
- Each validation pass
- Every 5 gradient accumulation steps

#### B. CUDA Memory Configuration
```python
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'max_split_size_mb:128'
```
**Effect**: Reduces memory fragmentation

#### C. Memory-Efficient Practices
- **Gradient Checkpointing**: Re-compute activations instead of storing
- **Delete Tensors**: Explicit `del` after use
- **Non-blocking Transfers**: Asynchronous CPU-GPU transfers
- **Pin Memory**: Faster data transfer in DataLoader

---

### 2. Data Loading Optimization

```python
DataLoader(
    dataset,
    batch_size=2,
    num_workers=2,              # Parallel data loading
    pin_memory=True,            # Faster GPU transfer
    prefetch_factor=2,          # Pre-load 2 batches
    persistent_workers=False,   # Don't keep workers alive
    drop_last=True              # Ignore incomplete batches
)
```

**Optimization Strategy**:
- 2 parallel workers load data while GPU trains
- Prefetch next 2 batches in background
- Pinned memory enables async transfers

---

### 3. Model Checkpointing

```python
torch.save({
    'epoch': epoch,
    'model_state_dict': model.state_dict(),
    'optimizer_state_dict': optimizer.state_dict(),
    'val_acc': val_acc,
    'config': CONFIG
}, save_path)
```

**Saved Information**:
- Model weights
- Optimizer state (for resuming training)
- Best validation accuracy
- Full configuration (reproducibility)

---

### 4. Reproducibility

```python
torch.manual_seed(42)
np.random.seed(42)
torch.cuda.manual_seed_all(42)
```

**Ensures**:
- Deterministic weight initialization
- Consistent data shuffling
- Reproducible results across runs

---

## Training Flow Summary

```
1. Load Data
   ├─ Scan class directories
   ├─ Balance classes (300 videos each)
   └─ Split train/val (80/20)
   
2. Create Datasets & DataLoaders
   ├─ Apply augmentations (train mode)
   ├─ Extract 60 frames per video
   └─ Setup parallel loading
   
3. Initialize Model
   ├─ Swin Small backbone (pre-trained)
   ├─ Context-aware temporal modules
   ├─ LSTM + Attention layers
   └─ Deep classifier (4 layers)
   
4. Setup Training
   ├─ AdaptiveFocalLoss
   ├─ AdamW optimizer (discriminative LR)
   ├─ OneCycleLR scheduler
   └─ Mixed precision scaler
   
5. Training Loop (10 epochs)
   ├─ Dynamic backbone freezing (epochs 0-1)
   ├─ Mixup augmentation (40% probability)
   ├─ Gradient accumulation (16 steps)
   ├─ Gradient clipping (max_norm=1.2)
   └─ Memory clearing
   
6. Validation
   ├─ Disable dropout & batch norm updates
   ├─ Compute metrics
   └─ Save best model
   
7. Early Stopping
   └─ Stop if no improvement for 5 epochs
   
8. Final Evaluation
   ├─ Load best checkpoint
   ├─ Classification report
   ├─ Confusion matrices
   └─ Training curves
```

---

## Performance Considerations

### Expected Results
- **Training Time**: ~2-3 hours on Tesla P100
- **Memory Usage**: ~14-15 GB peak
- **Validation Accuracy**: 85-92% (depending on data quality)

### Computational Complexity

| Component | Parameters | Computational Cost |
|-----------|------------|-------------------|
| Swin Small Backbone | ~50M | High (per frame) |
| Context Temporal | ~2M | Medium |
| LSTM | ~3M | Medium |
| Attention | ~5M | Medium |
| Classifier | ~3M | Low |
| **Total** | **~63M** | **High** |

### Bottlenecks
1. **Frame Extraction**: I/O bound (disk reads)
2. **Backbone Forward Pass**: Compute bound (60 frames × Swin)
3. **Memory**: 60 frames × 768 features = large tensors

---

## Potential Improvements

### 1. Architecture Enhancements
- [ ] Add temporal convolutional networks (TCN)
- [ ] Implement 3D convolutions for spatiotemporal features
- [ ] Try Vision Transformer (ViT) backbones
- [ ] Add multi-task learning (e.g., player detection)

### 2. Data Augmentation
- [ ] CutMix augmentation
- [ ] Temporal dropout (random frame masking)
- [ ] Speed perturbation (faster/slower playback)
- [ ] Adversarial training

### 3. Training Strategies
- [ ] Curriculum learning (easy → hard samples)
- [ ] Knowledge distillation from larger models
- [ ] Self-supervised pre-training on unlabeled football videos
- [ ] Test-time augmentation (TTA)

### 4. Optimization
- [ ] Efficient frame sampling (keyframe detection)
- [ ] Model pruning and quantization
- [ ] Neural Architecture Search (NAS)
- [ ] Distributed training across multiple GPUs

---

## Conclusion

This implementation represents a **state-of-the-art approach** to video action classification, combining:
- **Powerful spatial features** from Swin Transformer
- **Rich temporal modeling** through multi-scale convolutions, LSTM, and attention
- **Advanced training techniques** for limited data scenarios
- **Memory-efficient design** for consumer-grade GPUs

The modular architecture allows easy experimentation with different components, making it suitable for both research and production deployments.

---

## References & Resources

### Key Papers
1. **Swin Transformer**: Liu et al., "Swin Transformer: Hierarchical Vision Transformer using Shifted Windows" (ICCV 2021)
2. **Focal Loss**: Lin et al., "Focal Loss for Dense Object Detection" (ICCV 2017)
3. **Mixup**: Zhang et al., "mixup: Beyond Empirical Risk Minimization" (ICLR 2018)

### Libraries Used
- **PyTorch**: Deep learning framework
- **timm**: Pre-trained vision models
- **OpenCV**: Video processing
- **scikit-learn**: Evaluation metrics

---

**Document Version**: 1.0  
**Last Updated**: 2025  
**Author**: [Your Name]  
**License**: [Your License]