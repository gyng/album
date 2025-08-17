# SQLite WASM Vector Field Implementation Plan for Image Similarity Search

This document outlines a comprehensive implementation plan for adding image similarity search using vector embeddings to an existing SQLite WASM photo gallery application. The approach uses compile-time embedding generation in Python and runtime similarity search in the browser.

## 1. Architecture Overview

### **Compile-Time Processing**

- **Python indexing script**: Generate embeddings during image indexing
- **Separate vector database**: `vectors.db` alongside existing `database.db`
- **No runtime embedding generation**: All vectors pre-computed
- **Static serving**: Both databases served as static files

### **Frontend Integration**

- **Load both databases**: Main database + vector database in WASM
- **Image details panel**: Show 5 similar images in grid
- **Fast similarity lookup**: Pre-computed vectors enable instant search

## 2. Detailed Python Implementation

### **2.1 Environment Setup**

#### **Required Dependencies**

```python
# requirements.txt
sentence-transformers>=2.2.0
torch>=2.0.0
torchvision>=0.15.0
Pillow>=9.0.0
numpy>=1.21.0
scikit-learn>=1.3.0  # For additional vector operations
opencv-python>=4.8.0  # For advanced image preprocessing
tqdm>=4.64.0  # For progress bars
```

#### **Installation Commands**

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Download CLIP model (will happen automatically on first use)
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('clip-ViT-B-32')"
```

### **2.2 Embedding Model Selection**

#### **Model Options Comparison**

```python
# embedding_models.py
import time
from sentence_transformers import SentenceTransformer
from PIL import Image

class EmbeddingModelConfig:
    """Configuration for different embedding models"""

    MODELS = {
        'clip-vit-b-32': {
            'name': 'clip-ViT-B-32',
            'dimensions': 512,
            'description': 'Good balance of speed and accuracy',
            'memory_usage': '~1.2GB',
            'speed': 'Medium',
            'quality': 'High'
        },
        'clip-vit-l-14': {
            'name': 'clip-ViT-L-14',
            'dimensions': 768,
            'description': 'Higher accuracy, slower processing',
            'memory_usage': '~3.5GB',
            'speed': 'Slow',
            'quality': 'Very High'
        },
        'clip-vit-b-16': {
            'name': 'clip-ViT-B-16',
            'dimensions': 512,
            'description': 'Faster processing, good accuracy',
            'memory_usage': '~1.0GB',
            'speed': 'Fast',
            'quality': 'Good'
        }
    }

    @classmethod
    def get_recommended_model(cls, image_count: int) -> str:
        """Recommend model based on dataset size"""
        if image_count < 1000:
            return 'clip-vit-l-14'  # Best quality for small datasets
        elif image_count < 10000:
            return 'clip-vit-b-32'  # Balanced for medium datasets
        else:
            return 'clip-vit-b-16'  # Fastest for large datasets

def benchmark_model(model_name: str, test_images: list) -> dict:
    """Benchmark a model's performance"""
    print(f"Benchmarking {model_name}...")

    model = SentenceTransformer(model_name)

    # Warm up
    test_img = Image.new('RGB', (224, 224))
    model.encode(test_img)

    # Benchmark
    start_time = time.time()
    for img_path in test_images[:10]:  # Test with 10 images
        img = Image.open(img_path).convert('RGB')
        embedding = model.encode(img)

    avg_time = (time.time() - start_time) / len(test_images[:10])

    return {
        'model': model_name,
        'avg_time_per_image': avg_time,
        'estimated_time_1k_images': avg_time * 1000 / 60,  # minutes
        'embedding_dimensions': len(embedding)
    }
```

#### **Model Selection Script**

```python
# model_selector.py
import argparse
import glob
from embedding_models import EmbeddingModelConfig, benchmark_model

def select_optimal_model(image_directory: str, sample_size: int = 20):
    """Help select the optimal model for the dataset"""

    # Get sample images
    image_patterns = ['*.jpg', '*.jpeg', '*.png', '*.webp']
    all_images = []
    for pattern in image_patterns:
        all_images.extend(glob.glob(f"{image_directory}/**/{pattern}", recursive=True))

    sample_images = all_images[:sample_size]
    total_images = len(all_images)

    print(f"Found {total_images} images total")
    print(f"Testing with {len(sample_images)} sample images")
    print()

    # Get recommendation
    recommended = EmbeddingModelConfig.get_recommended_model(total_images)
    print(f"Recommended model for {total_images} images: {recommended}")
    print()

    # Benchmark if requested
    print("Available models:")
    for key, config in EmbeddingModelConfig.MODELS.items():
        print(f"  {key}:")
        print(f"    Name: {config['name']}")
        print(f"    Dimensions: {config['dimensions']}")
        print(f"    Description: {config['description']}")
        print(f"    Memory: {config['memory_usage']}")
        print(f"    Speed: {config['speed']}")
        print(f"    Quality: {config['quality']}")
        print()

    # Run benchmark on recommended model
    if sample_images:
        benchmark_result = benchmark_model(
            EmbeddingModelConfig.MODELS[recommended]['name'],
            sample_images
        )
        print("Benchmark Results:")
        print(f"  Average time per image: {benchmark_result['avg_time_per_image']:.3f}s")
        print(f"  Estimated time for 1K images: {benchmark_result['estimated_time_1k_images']:.1f} minutes")
        print(f"  Embedding dimensions: {benchmark_result['embedding_dimensions']}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Select optimal embedding model')
    parser.add_argument('--image-dir', required=True, help='Directory containing images')
    parser.add_argument('--sample-size', type=int, default=20, help='Number of images to test')

    args = parser.parse_args()
    select_optimal_model(args.image_dir, args.sample_size)
```

### **2.3 Advanced Image Preprocessing**

```python
# image_processor.py
import cv2
import numpy as np
from PIL import Image, ImageEnhance, ExifTags
import torch
from torchvision import transforms

class ImagePreprocessor:
    """Advanced image preprocessing for better embeddings"""

    def __init__(self, target_size=(224, 224), enhance_quality=True):
        self.target_size = target_size
        self.enhance_quality = enhance_quality

        # Standard transforms for CLIP models
        self.transform = transforms.Compose([
            transforms.Resize(target_size),
            transforms.CenterCrop(target_size),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            )
        ])

    def fix_image_orientation(self, image: Image.Image) -> Image.Image:
        """Fix image orientation based on EXIF data"""
        try:
            for orientation in ExifTags.TAGS.keys():
                if ExifTags.TAGS[orientation] == 'Orientation':
                    break

            exif = image._getexif()
            if exif is not None:
                orientation = exif.get(orientation)
                if orientation == 3:
                    image = image.rotate(180, expand=True)
                elif orientation == 6:
                    image = image.rotate(270, expand=True)
                elif orientation == 8:
                    image = image.rotate(90, expand=True)
        except (AttributeError, KeyError, TypeError):
            pass

        return image

    def enhance_image_quality(self, image: Image.Image) -> Image.Image:
        """Enhance image quality for better embeddings"""
        if not self.enhance_quality:
            return image

        # Enhance contrast slightly
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(1.1)

        # Enhance sharpness slightly
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(1.1)

        return image

    def detect_and_crop_main_subject(self, image: Image.Image) -> Image.Image:
        """Use simple edge detection to focus on main subject"""
        # Convert to OpenCV format
        cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

        # Convert to grayscale
        gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)

        # Apply Gaussian blur
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Edge detection
        edges = cv2.Canny(blurred, 50, 150)

        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if contours:
            # Find the largest contour (assumed to be main subject)
            largest_contour = max(contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(largest_contour)

            # Add padding around the detected area
            padding = 0.1
            pad_w, pad_h = int(w * padding), int(h * padding)

            # Ensure bounds are within image
            img_w, img_h = image.size
            x1 = max(0, x - pad_w)
            y1 = max(0, y - pad_h)
            x2 = min(img_w, x + w + pad_w)
            y2 = min(img_h, y + h + pad_h)

            # Crop to detected area if it's reasonable
            if (x2 - x1) > img_w * 0.3 and (y2 - y1) > img_h * 0.3:
                return image.crop((x1, y1, x2, y2))

        return image

    def preprocess_image(self, image_path: str, smart_crop=False) -> Image.Image:
        """Complete preprocessing pipeline"""
        try:
            # Load image
            image = Image.open(image_path).convert('RGB')

            # Fix orientation
            image = self.fix_image_orientation(image)

            # Optional smart cropping
            if smart_crop:
                image = self.detect_and_crop_main_subject(image)

            # Enhance quality
            image = self.enhance_image_quality(image)

            # Resize to target size
            image = image.resize(self.target_size, Image.Resampling.LANCZOS)

            return image

        except Exception as e:
            print(f"Error preprocessing {image_path}: {e}")
            # Return a blank image as fallback
            return Image.new('RGB', self.target_size, color='white')
```

### **2.4 Main Vector Indexing Implementation**

```python
# vector_indexer.py
import sqlite3
import json
import numpy as np
from sentence_transformers import SentenceTransformer
from PIL import Image
import torch
from tqdm import tqdm
import logging
from pathlib import Path
import hashlib
from typing import Optional, List, Tuple
import argparse
import time

from image_processor import ImagePreprocessor
from embedding_models import EmbeddingModelConfig

class VectorIndexer:
    """Main class for generating and storing image embeddings"""

    def __init__(self,
                 model_name: str = 'clip-ViT-B-32',
                 enable_preprocessing: bool = True,
                 smart_crop: bool = False,
                 batch_size: int = 32):

        self.model_name = model_name
        self.batch_size = batch_size
        self.enable_preprocessing = enable_preprocessing
        self.smart_crop = smart_crop

        # Initialize model
        print(f"Loading model: {model_name}")
        self.model = SentenceTransformer(model_name)
        self.embedding_dim = self.model.get_sentence_embedding_dimension()
        print(f"Model loaded. Embedding dimension: {self.embedding_dim}")

        # Initialize preprocessor
        if enable_preprocessing:
            self.preprocessor = ImagePreprocessor()
        else:
            self.preprocessor = None

        # Setup logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)

    def generate_image_embedding(self, image_path: str) -> Optional[np.ndarray]:
        """Generate embedding vector for a single image"""
        try:
            if self.preprocessor:
                image = self.preprocessor.preprocess_image(
                    image_path,
                    smart_crop=self.smart_crop
                )
            else:
                image = Image.open(image_path).convert('RGB')
                image = image.resize((224, 224))

            # Generate embedding
            embedding = self.model.encode(image, convert_to_numpy=True)
            return embedding.astype(np.float32)

        except Exception as e:
            self.logger.error(f"Failed to generate embedding for {image_path}: {e}")
            return None

    def generate_batch_embeddings(self, image_paths: List[str]) -> List[Optional[np.ndarray]]:
        """Generate embeddings for a batch of images (more efficient)"""
        images = []
        valid_indices = []

        # Load and preprocess images
        for i, image_path in enumerate(image_paths):
            try:
                if self.preprocessor:
                    image = self.preprocessor.preprocess_image(
                        image_path,
                        smart_crop=self.smart_crop
                    )
                else:
                    image = Image.open(image_path).convert('RGB')
                    image = image.resize((224, 224))

                images.append(image)
                valid_indices.append(i)

            except Exception as e:
                self.logger.error(f"Failed to load image {image_path}: {e}")

        # Generate embeddings for valid images
        embeddings = [None] * len(image_paths)
        if images:
            try:
                batch_embeddings = self.model.encode(
                    images,
                    convert_to_numpy=True,
                    show_progress_bar=False
                )

                for i, embedding in enumerate(batch_embeddings):
                    original_index = valid_indices[i]
                    embeddings[original_index] = embedding.astype(np.float32)

            except Exception as e:
                self.logger.error(f"Batch embedding generation failed: {e}")

        return embeddings

    def create_vector_database(self, output_path: str) -> Tuple[sqlite3.Connection, sqlite3.Cursor]:
        """Create separate vector database with sqlite-vec"""

        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(output_path)
        cursor = conn.cursor()

        # Enable sqlite-vec extension (if available)
        try:
            cursor.execute("SELECT load_extension('vec0')")
        except sqlite3.OperationalError:
            # Fallback for systems without sqlite-vec extension
            self.logger.warning("sqlite-vec extension not available, using standard tables")

        # Create vector table
        try:
            # Try sqlite-vec syntax first
            cursor.execute(f"""
                CREATE VIRTUAL TABLE image_vectors USING vec0(
                    embedding float[{self.embedding_dim}]
                );
            """)
            self.using_vec_extension = True
            self.logger.info("Using sqlite-vec extension for vector storage")

        except sqlite3.OperationalError:
            # Fallback to standard table with JSON storage
            cursor.execute(f"""
                CREATE TABLE image_vectors (
                    rowid INTEGER PRIMARY KEY,
                    embedding TEXT NOT NULL
                );
            """)
            self.using_vec_extension = False
            self.logger.info("Using standard table with JSON storage for vectors")

        # Create metadata table linking to main database
        cursor.execute("""
            CREATE TABLE vector_metadata (
                rowid INTEGER PRIMARY KEY,
                image_path TEXT UNIQUE NOT NULL,
                model_name TEXT NOT NULL,
                embedding_dim INTEGER NOT NULL,
                file_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create indexes for performance
        cursor.execute("""
            CREATE INDEX idx_vector_metadata_path ON vector_metadata(image_path);
        """)

        cursor.execute("""
            CREATE INDEX idx_vector_metadata_hash ON vector_metadata(file_hash);
        """)

        # Store configuration
        cursor.execute("""
            CREATE TABLE vector_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)

        config_data = {
            'model_name': self.model_name,
            'embedding_dim': str(self.embedding_dim),
            'batch_size': str(self.batch_size),
            'preprocessing_enabled': str(self.enable_preprocessing),
            'smart_crop': str(self.smart_crop),
            'created_at': str(int(time.time()))
        }

        for key, value in config_data.items():
            cursor.execute(
                "INSERT INTO vector_config (key, value) VALUES (?, ?)",
                (key, value)
            )

        conn.commit()
        return conn, cursor

    def get_file_hash(self, file_path: str) -> str:
        """Generate hash for file to detect changes"""
        try:
            with open(file_path, 'rb') as f:
                # Read first 8KB for hash (faster than full file)
                chunk = f.read(8192)
                return hashlib.md5(chunk).hexdigest()
        except Exception:
            return ""

    def should_regenerate_embedding(self, cursor: sqlite3.Cursor,
                                   image_path: str, file_hash: str) -> bool:
        """Check if embedding needs to be regenerated"""
        cursor.execute("""
            SELECT file_hash, model_name FROM vector_metadata
            WHERE image_path = ?
        """, (image_path,))

        result = cursor.fetchone()
        if not result:
            return True  # New file

        stored_hash, stored_model = result

        # Regenerate if file changed or model changed
        return (stored_hash != file_hash or stored_model != self.model_name)

    def index_image_vectors(self, main_db_path: str, vector_db_path: str,
                           force_regenerate: bool = False):
        """Process all images and create vector database"""

        # Connect to main database to get image list
        if not Path(main_db_path).exists():
            raise FileNotFoundError(f"Main database not found: {main_db_path}")

        main_conn = sqlite3.connect(main_db_path)
        main_cursor = main_conn.cursor()

        # Get all images from main database
        main_cursor.execute("SELECT path FROM images ORDER BY path")
        image_paths = [row[0] for row in main_cursor.fetchall()]
        main_conn.close()

        if not image_paths:
            self.logger.error("No images found in main database")
            return

        # Create or connect to vector database
        vector_conn, vector_cursor = self.create_vector_database(vector_db_path)

        self.logger.info(f"Processing {len(image_paths)} images for vector embeddings...")

        # Process in batches
        processed_count = 0
        skipped_count = 0
        error_count = 0

        for i in tqdm(range(0, len(image_paths), self.batch_size),
                     desc="Processing image batches"):

            batch_paths = image_paths[i:i + self.batch_size]
            batch_to_process = []
            batch_indices = []

            # Check which images need processing
            for j, image_path in enumerate(batch_paths):
                file_hash = self.get_file_hash(image_path)

                if force_regenerate or self.should_regenerate_embedding(
                    vector_cursor, image_path, file_hash
                ):
                    batch_to_process.append(image_path)
                    batch_indices.append(j)
                else:
                    skipped_count += 1

            if not batch_to_process:
                continue

            # Generate embeddings for batch
            embeddings = self.generate_batch_embeddings(batch_to_process)

            # Store embeddings
            for k, embedding in enumerate(embeddings):
                image_path = batch_to_process[k]
                file_hash = self.get_file_hash(image_path)

                if embedding is None:
                    error_count += 1
                    continue

                try:
                    # Remove existing entry if it exists
                    vector_cursor.execute(
                        "DELETE FROM vector_metadata WHERE image_path = ?",
                        (image_path,)
                    )

                    # Insert metadata
                    vector_cursor.execute("""
                        INSERT INTO vector_metadata
                        (image_path, model_name, embedding_dim, file_hash)
                        VALUES (?, ?, ?, ?)
                    """, (image_path, self.model_name, self.embedding_dim, file_hash))

                    metadata_rowid = vector_cursor.lastrowid

                    # Insert vector
                    if self.using_vec_extension:
                        # Use sqlite-vec format
                        embedding_json = json.dumps(embedding.tolist())
                        vector_cursor.execute(
                            "INSERT INTO image_vectors (rowid, embedding) VALUES (?, ?)",
                            (metadata_rowid, embedding_json)
                        )
                    else:
                        # Use standard table with JSON
                        embedding_json = json.dumps(embedding.tolist())
                        vector_cursor.execute(
                            "INSERT INTO image_vectors (rowid, embedding) VALUES (?, ?)",
                            (metadata_rowid, embedding_json)
                        )

                    processed_count += 1

                except Exception as e:
                    self.logger.error(f"Failed to insert vector for {image_path}: {e}")
                    error_count += 1
                    vector_conn.rollback()
                    continue

            # Commit batch
            vector_conn.commit()

            # Progress update
            if i % (self.batch_size * 10) == 0:
                self.logger.info(f"Progress: {processed_count} processed, "
                               f"{skipped_count} skipped, {error_count} errors")

        # Final statistics
        vector_conn.close()

        self.logger.info(f"Vector indexing complete!")
        self.logger.info(f"  Processed: {processed_count}")
        self.logger.info(f"  Skipped: {skipped_count}")
        self.logger.info(f"  Errors: {error_count}")
        self.logger.info(f"  Vector database: {vector_db_path}")

        # Print database size
        db_size = Path(vector_db_path).stat().st_size / (1024 * 1024)
        self.logger.info(f"  Database size: {db_size:.1f} MB")

def main():
    """Main entry point with command line interface"""
    parser = argparse.ArgumentParser(description='Generate image embeddings for similarity search')

    parser.add_argument('--main-db', required=True,
                       help='Path to main SQLite database')
    parser.add_argument('--vector-db', required=True,
                       help='Path to output vector database')
    parser.add_argument('--model',
                       choices=['clip-vit-b-32', 'clip-vit-l-14', 'clip-vit-b-16'],
                       default='clip-vit-b-32',
                       help='Embedding model to use')
    parser.add_argument('--batch-size', type=int, default=32,
                       help='Batch size for processing')
    parser.add_argument('--force-regenerate', action='store_true',
                       help='Force regeneration of all embeddings')
    parser.add_argument('--enable-preprocessing', action='store_true', default=True,
                       help='Enable advanced image preprocessing')
    parser.add_argument('--smart-crop', action='store_true',
                       help='Enable smart cropping to focus on main subject')
    parser.add_argument('--benchmark', action='store_true',
                       help='Run model benchmark before processing')

    args = parser.parse_args()

    # Model name mapping
    model_mapping = {
        'clip-vit-b-32': 'clip-ViT-B-32',
        'clip-vit-l-14': 'clip-ViT-L-14',
        'clip-vit-b-16': 'clip-ViT-B-16'
    }

    model_name = model_mapping[args.model]

    # Benchmark if requested
    if args.benchmark:
        from model_selector import benchmark_model
        import glob

        # Get sample images from main database
        main_conn = sqlite3.connect(args.main_db)
        main_cursor = main_conn.cursor()
        main_cursor.execute("SELECT path FROM images LIMIT 10")
        sample_paths = [row[0] for row in main_cursor.fetchall()]
        main_conn.close()

        if sample_paths:
            result = benchmark_model(model_name, sample_paths)
            print("Benchmark Results:")
            for key, value in result.items():
                print(f"  {key}: {value}")

            input("Press Enter to continue with indexing...")

    # Initialize indexer
    indexer = VectorIndexer(
        model_name=model_name,
        enable_preprocessing=args.enable_preprocessing,
        smart_crop=args.smart_crop,
        batch_size=args.batch_size
    )

    # Generate embeddings
    indexer.index_image_vectors(
        main_db_path=args.main_db,
        vector_db_path=args.vector_db,
        force_regenerate=args.force_regenerate
    )

if __name__ == "__main__":
    main()
```

### **2.5 Integration with Existing Indexing Script**

```python
# Modified main indexing script
# indexing_script.py (additions)

import sys
from pathlib import Path

# Add vector indexing functionality
def add_vector_indexing_to_main_script():
    """Add this to your existing indexing script"""

    # Import vector indexer
    from vector_indexer import VectorIndexer
    from embedding_models import EmbeddingModelConfig

    def generate_vectors(main_db_path: str, output_dir: str,
                        force_regenerate: bool = False):
        """Generate vectors as part of main indexing process"""

        vector_db_path = Path(output_dir) / "vectors.db"

        print("Starting vector embedding generation...")

        # Auto-select model based on image count
        import sqlite3
        conn = sqlite3.connect(main_db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM images")
        image_count = cursor.fetchone()[0]
        conn.close()

        model_key = EmbeddingModelConfig.get_recommended_model(image_count)
        model_name = EmbeddingModelConfig.MODELS[model_key]['name']

        print(f"Auto-selected model: {model_name} for {image_count} images")

        # Initialize indexer with optimal settings
        indexer = VectorIndexer(
            model_name=model_name,
            enable_preprocessing=True,
            smart_crop=False,  # Can be slow, disable for large datasets
            batch_size=16 if image_count > 5000 else 32
        )

        # Generate embeddings
        indexer.index_image_vectors(
            main_db_path=main_db_path,
            vector_db_path=str(vector_db_path),
            force_regenerate=force_regenerate
        )

        return str(vector_db_path)

    # Add to your main function
    def main():
        # ... existing indexing code ...

        # After main database is created
        main_db_path = "output/database.db"
        output_dir = "output"

        # Generate vectors
        vector_db_path = generate_vectors(
            main_db_path=main_db_path,
            output_dir=output_dir,
            force_regenerate=False  # Set to True to regenerate all
        )

        print(f"Indexing complete!")
        print(f"Main database: {main_db_path}")
        print(f"Vector database: {vector_db_path}")

if __name__ == "__main__":
    main()
```

### **2.6 Performance Monitoring and Optimization**

```python
# performance_monitor.py
import time
import psutil
import sqlite3
from pathlib import Path
import json

class PerformanceMonitor:
    """Monitor and optimize vector generation performance"""

    def __init__(self):
        self.start_time = None
        self.stats = {
            'images_processed': 0,
            'total_time': 0,
            'avg_time_per_image': 0,
            'peak_memory_mb': 0,
            'errors': 0
        }

    def start_monitoring(self):
        """Start performance monitoring"""
        self.start_time = time.time()
        process = psutil.Process()
        self.initial_memory = process.memory_info().rss / 1024 / 1024

    def update_stats(self, images_processed: int, errors: int):
        """Update performance statistics"""
        if self.start_time is None:
            return

        current_time = time.time()
        elapsed = current_time - self.start_time

        process = psutil.Process()
        current_memory = process.memory_info().rss / 1024 / 1024

        self.stats.update({
            'images_processed': images_processed,
            'total_time': elapsed,
            'avg_time_per_image': elapsed / max(1, images_processed),
            'peak_memory_mb': max(self.stats['peak_memory_mb'], current_memory),
            'errors': errors
        })

    def get_recommendations(self, total_images: int) -> dict:
        """Get performance optimization recommendations"""
        recommendations = []

        if self.stats['avg_time_per_image'] > 2.0:
            recommendations.append("Consider using a faster model (clip-vit-b-16)")

        if self.stats['peak_memory_mb'] > 8000:
            recommendations.append("Reduce batch size to lower memory usage")

        if self.stats['errors'] / max(1, self.stats['images_processed']) > 0.1:
            recommendations.append("High error rate - check image quality and preprocessing")

        estimated_total_time = self.stats['avg_time_per_image'] * total_images / 60
        if estimated_total_time > 60:
            recommendations.append(f"Estimated total time: {estimated_total_time:.1f} minutes")

        return {
            'stats': self.stats,
            'recommendations': recommendations,
            'estimated_total_time_minutes': estimated_total_time
        }

def optimize_database(db_path: str):
    """Optimize vector database for better performance"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("Optimizing vector database...")

    # Analyze and optimize
    cursor.execute("ANALYZE")
    cursor.execute("VACUUM")

    # Get database statistics
    cursor.execute("SELECT COUNT(*) FROM vector_metadata")
    vector_count = cursor.fetchone()[0]

    file_size = Path(db_path).stat().st_size / 1024 / 1024

    conn.close()

    print(f"Database optimization complete:")
    print(f"  Vectors: {vector_count}")
    print(f"  File size: {file_size:.1f} MB")
    print(f"  Average size per vector: {file_size / max(1, vector_count) * 1024:.1f} KB")
```

## 3. Frontend Database Integration

### **Extend useDatabase Hook**

```typescript
// useDatabase.tsx modifications
interface DatabasePair {
  main: Database;
  vectors: Database;
}

export const useDatabase = (): [DatabasePair | null, number] => {
  const [databases, setDatabases] = useState<DatabasePair | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const loadDatabases = async () => {
      try {
        setProgress(25);
        const sqlite3 = await initSqlite(); // Include sqlite-vec

        setProgress(50);
        // Load main database
        const mainResponse = await fetch("/database.db");
        const mainArrayBuffer = await mainResponse.arrayBuffer();
        const mainDb = new sqlite3.oo1.DB();
        mainDb.deserialize(new Uint8Array(mainArrayBuffer));

        setProgress(75);
        // Load vector database
        const vectorResponse = await fetch("/vectors.db");
        const vectorArrayBuffer = await vectorResponse.arrayBuffer();
        const vectorDb = new sqlite3.oo1.DB();
        vectorDb.deserialize(new Uint8Array(vectorArrayBuffer));

        setProgress(100);
        setDatabases({ main: mainDb, vectors: vectorDb });
      } catch (error) {
        console.error("Failed to load databases:", error);
      }
    };

    loadDatabases();
  }, []);

  return [databases, progress];
};
```

### **Add Similarity Search API**

```typescript
// api.ts additions
export const fetchSimilarImages = async (opts: {
  mainDb: Database;
  vectorDb: Database;
  imagePath: string;
  limit?: number;
}): Promise<any[]> => {
  const { mainDb, vectorDb, imagePath, limit = 5 } = opts;

  try {
    // Get the embedding for the query image
    const queryResult = vectorDb.selectArray(
      `
      SELECT vm.rowid, iv.embedding 
      FROM vector_metadata vm
      JOIN image_vectors iv ON iv.rowid = vm.rowid
      WHERE vm.image_path = ?
    `,
      [imagePath],
    );

    if (queryResult.length === 0) {
      console.warn("No embedding found for image:", imagePath);
      return [];
    }

    const [queryRowid, queryEmbedding] = queryResult[0];

    // Find similar images using vector search
    const similarResults = vectorDb.selectArray(
      `
      SELECT vm.image_path, iv.distance
      FROM image_vectors iv
      JOIN vector_metadata vm ON vm.rowid = iv.rowid
      WHERE iv.embedding MATCH ? 
        AND vm.rowid != ?
      ORDER BY iv.distance
      LIMIT ?
    `,
      [queryEmbedding, queryRowid, limit],
    );

    // Get full image details from main database
    const imagePaths = similarResults.map((row) => row[0]);
    if (imagePaths.length === 0) return [];

    const placeholders = imagePaths.map(() => "?").join(",");
    const imageDetails = mainDb.selectArray(
      `
      SELECT path, filename, tags, exif, geocode
      FROM images 
      WHERE path IN (${placeholders})
    `,
      imagePaths,
    );

    // Combine similarity scores with image details
    return imageDetails.map((details, index) => ({
      path: details[0],
      filename: details[1],
      tags: details[2],
      exif: details[3],
      geocode: details[4],
      similarity: similarResults[index][1], // distance score
    }));
  } catch (error) {
    console.error("Similarity search failed:", error);
    return [];
  }
};
```

## 4. Image Details Panel UI

### **Create Similarity Grid Component**

```typescript
// SimilarImages.tsx (new component)
interface SimilarImagesProps {
  imagePath: string;
  databases: DatabasePair;
}

export const SimilarImages: React.FC<SimilarImagesProps> = ({
  imagePath,
  databases
}) => {
  const [similarImages, setSimilarImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!databases || !imagePath) return;

    const loadSimilar = async () => {
      setLoading(true);
      try {
        const similar = await fetchSimilarImages({
          mainDb: databases.main,
          vectorDb: databases.vectors,
          imagePath,
          limit: 5
        });
        setSimilarImages(similar);
      } catch (error) {
        console.error('Failed to load similar images:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSimilar();
  }, [databases, imagePath]);

  if (loading) {
    return (
      <div className={styles.similarSection}>
        <h3>Similar Images</h3>
        <div className={styles.loading}>Loading similar images...</div>
      </div>
    );
  }

  if (similarImages.length === 0) {
    return (
      <div className={styles.similarSection}>
        <h3>Similar Images</h3>
        <div className={styles.noResults}>No similar images found</div>
      </div>
    );
  }

  return (
    <div className={styles.similarSection}>
      <h3>Similar Images</h3>
      <div className={styles.similarGrid}>
        {similarImages.map((image, index) => (
          <div key={image.path} className={styles.similarItem}>
            <img
              src={image.path}
              alt={image.filename}
              className={styles.similarImage}
              loading="lazy"
            />
            <div className={styles.similarMeta}>
              <div className={styles.filename}>{image.filename}</div>
              <div className={styles.similarity}>
                {Math.round((1 - image.similarity) * 100)}% similar
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### **Add Styles for Similarity Grid**

```css
/* SimilarImages.module.css */
.similarSection {
  margin-top: var(--m-l);
  padding-top: var(--m-l);
  border-top: 1px solid var(--c-bg-contrast-light);
}

.similarGrid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--m-m);
  margin-top: var(--m-m);
}

.similarItem {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--m-s);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.similarItem:hover {
  transform: scale(1.05);
}

.similarImage {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.similarMeta {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  color: white;
  padding: var(--m-s);
  font-size: var(--fs-s);
}

.filename {
  font-weight: bold;
  margin-bottom: 2px;
}

.similarity {
  opacity: 0.8;
  font-size: calc(var(--fs-s) * 0.9);
}

.loading,
.noResults {
  text-align: center;
  padding: var(--m-l);
  color: var(--c-bg-contrast-light);
  font-style: italic;
}

@media (max-width: 768px) {
  .similarGrid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 480px) {
  .similarGrid {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

### **Integrate into Existing Image Details Panel**

```typescript
// Update existing image details component
import { SimilarImages } from './SimilarImages';

// In your image details component:
const ImageDetailsPanel = ({ imagePath }) => {
  const [databases] = useDatabase();

  return (
    <div className={styles.detailsPanel}>
      {/* Existing image details */}
      <div className={styles.imageInfo}>
        {/* Current metadata display */}
      </div>

      {/* Add similarity section */}
      {databases && (
        <SimilarImages
          imagePath={imagePath}
          databases={databases}
        />
      )}
    </div>
  );
};
```

## 5. Build Process Integration

### **Update Build Pipeline**

```bash
#!/bin/bash
# build.sh additions

echo "Starting build process with vector search..."

# Step 1: Generate main database
echo "Generating main database..."
python indexing_script.py --input-dir ./images --output-dir ./output

# Step 2: Generate vector embeddings
echo "Generating image embeddings..."
python vector_indexer.py \
  --main-db ./output/database.db \
  --vector-db ./output/vectors.db \
  --model clip-vit-b-32 \
  --batch-size 32 \
  --enable-preprocessing

# Step 3: Optimize databases
echo "Optimizing databases..."
python -c "
from performance_monitor import optimize_database
optimize_database('./output/database.db')
optimize_database('./output/vectors.db')
"

# Step 4: Build frontend with sqlite-vec WASM
echo "Building frontend with vector search support..."
npm run build

# Step 5: Copy databases to public directory
echo "Copying databases..."
cp output/database.db public/
cp output/vectors.db public/

echo "Build complete with vector search support!"
echo "Database sizes:"
ls -lh public/*.db
```

### **Deploy Configuration**

```typescript
// next.config.js additions
module.exports = {
  // Ensure both databases are served as static files
  async headers() {
    return [
      {
        source: "/(database|vectors).db",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
    ];
  },

  // Webpack configuration for sqlite-vec WASM
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};
```

## 6. Complete Implementation Roadmap

### **Phase 1: Python Environment Setup (1 day)**

1. Set up Python environment with required dependencies
2. Test embedding models with sample images
3. Benchmark different models for your dataset size
4. Choose optimal model and preprocessing settings

### **Phase 2: Vector Database Generation (1-2 days)**

1. Implement vector indexing script
2. Integrate with existing indexing pipeline
3. Generate vector database for your image collection
4. Test and optimize performance

### **Phase 3: SQLite WASM with sqlite-vec (1 day)**

1. Set up sqlite-vec WASM build
2. Update frontend database loading to handle dual databases
3. Test vector similarity queries in browser

### **Phase 4: Similarity Search API (1 day)**

1. Implement `fetchSimilarImages` function
2. Test vector similarity queries
3. Optimize query performance and error handling

### **Phase 5: UI Components (1-2 days)**

1. Create `SimilarImages` component
2. Add to image details panel
3. Style similarity grid with responsive design
4. Add loading states and error handling

### **Phase 6: Integration & Testing (1 day)**

1. End-to-end testing with real data
2. Performance optimization
3. Error handling and edge cases
4. Cross-browser compatibility testing

### **Phase 7: Deployment (0.5 days)**

1. Update build pipeline
2. Configure static file serving for both databases
3. Deploy with vector search functionality

## 7. Performance & Considerations

### **Database Size Estimates**

- **Vector database size**: ~50-100MB for 10k images (512-dim vectors)
- **Total download**: Main DB + Vector DB on initial load
- **Caching strategy**: Static files cached indefinitely with proper headers

### **Search Performance**

- **Pre-computed vectors**: Instant similarity search once databases loaded
- **sqlite-vec optimization**: Efficient brute-force search for small-medium datasets
- **Limited scope**: 5 similar images per query keeps performance high

### **Maintenance Considerations**

- **Rebuild required**: When adding new images, both databases need regeneration
- **Version control**: Both databases should be versioned together
- **Incremental updates**: Possible with file hash checking in Python script
- **Model updates**: Easy to regenerate with newer/better models

### **Scalability Notes**

- **Up to 100k images**: Should work well with current approach
- **Beyond 100k images**: Consider more sophisticated indexing (FAISS, etc.)
- **Multiple models**: Can support different embedding models for different use cases

This implementation provides fast, offline image similarity search with minimal runtime complexity by moving all computation to build time, resulting in a smooth user experience with instant similarity results.
